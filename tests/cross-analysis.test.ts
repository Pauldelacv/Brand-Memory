import { describe, expect, it } from "vitest";
import {
  bestMatch,
  combineScore,
  lexicalSimilarity,
  polarityConflict,
  recencyScore,
  runCrossAnalysis,
} from "@/lib/external/cross-analysis";
import type { CrossAnalysisInput } from "@/lib/external/cross-analysis";
import { NOW, externalTheme, internalClaim, monthlyDates, observations } from "./fixtures/external";
import type { BrandInsightKind } from "@/types/external";

/**
 * The strategic core: what the brand says it is, measured against what it has
 * actually published. Every case here is a question a brand team would ask.
 */

function analyse(input: Partial<CrossAnalysisInput>) {
  return runCrossAnalysis({
    internal: [],
    external: [],
    observations: [],
    options: { now: NOW, windowMonths: 12 },
    ...input,
  });
}

function kinds(insights: ReadonlyArray<{ kind: BrandInsightKind }>): BrandInsightKind[] {
  return insights.map((insight) => insight.kind);
}

describe("similarity", () => {
  it("ignores stop words in both languages", () => {
    expect(lexicalSimilarity("the brand repairs every frame", "we repair every frame")).toBeGreaterThan(0.3);
    expect(lexicalSimilarity("our positioning is premium", "notre positionnement est premium")).toBeGreaterThan(0);
  });

  it("finds the closest external theme to an internal claim", () => {
    const claim = internalClaim({ title: "Durability", content: "Every frame can be repaired." });
    const match = bestMatch(claim, [
      externalTheme({ id: "far", label: "pricing", title: "Pricing", content: "Direct sales only." }),
      externalTheme({ id: "near", label: "repairability", title: "Repairability", content: "Every frame can be repaired." }),
    ]);

    expect(match?.theme.id).toBe("near");
  });
});

describe("scoring", () => {
  it("is a weighted mean of its components", () => {
    expect(
      combineScore([
        { name: "a", value: 1, weight: 0.5, detail: "" },
        { name: "b", value: 0, weight: 0.5, detail: "" },
      ]),
    ).toBe(0.5);
  });

  it("decays with time on a twelve-month half-life", () => {
    expect(recencyScore(NOW.toISOString(), NOW)).toBeCloseTo(1, 2);
    expect(recencyScore("2025-01-15T00:00:00.000Z", NOW)).toBeCloseTo(0.5, 1);
    expect(recencyScore(null, NOW)).toBe(0);
  });
});

describe("contradiction detection", () => {
  it("sees that premium and exclusive contradicts accessible to everyone", () => {
    // Cosine similarity cannot see this: the two statements are about the same
    // subject and therefore close. Detection needs an explicit opposition.
    const conflict = polarityConflict(
      "Velvire is a premium, exclusive frame builder.",
      "Velvire is accessible to everyone, with an entry-level frame.",
    );

    expect(conflict).not.toBeNull();
    expect(conflict?.internalTerm).toBe("premium");
    expect(conflict?.externalTerm).toBe("accessible");
  });

  it("does not fire when one side holds both poles on purpose", () => {
    expect(
      polarityConflict(
        "Premium quality at an accessible price — that tension is the brand.",
        "An accessible frame for everyone.",
      ),
    ).toBeNull();
  });

  it("does not fire on two statements about different things", () => {
    expect(
      polarityConflict("Our frames are built by eleven people.", "The atelier opens on 18 March."),
    ).toBeNull();
  });

  it("reports the contradiction with both positions and the public weight behind it", () => {
    const claim = internalClaim({
      id: "internal-positioning",
      title: "Positioning",
      content: "Velvire is a premium, exclusive frame builder for collectors.",
      origin: "USER_EDITED",
    });
    const theme = externalTheme({
      id: "accessible",
      kind: "POSITIONING",
      label: "accessible pricing",
      title: "Accessible pricing",
      content: "Velvire is accessible to everyone, an affordable frame for commuters.",
      occurrenceCount: 6,
      sourceCount: 4,
      firstSeenAt: "2025-02-01T00:00:00.000Z",
      lastSeenAt: "2025-11-01T00:00:00.000Z",
    });

    const result = analyse({
      internal: [claim],
      external: [theme],
      observations: observations("accessible", "accessible pricing", monthlyDates("2025-02-01T00:00:00.000Z", 6, 2), "POSITIONING"),
    });

    const contradiction = result.insights.find((insight) => insight.kind === "CONTRADICTION");

    expect(contradiction).toBeDefined();
    expect(contradiction?.summary).toContain("premium");
    expect(contradiction?.summary).toContain("accessible");
    expect(contradiction?.explanation).toContain("6 public contents");
    expect(contradiction?.explanation).toContain("4 sources");
    expect(contradiction?.internalEntryIds).toEqual(["internal-positioning"]);
    expect(contradiction?.components.map((part) => part.name)).toContain("source diversity");
  });
});

describe("alignment and absence", () => {
  it("calls a claim the brand actually communicates aligned", () => {
    const claim = internalClaim({
      title: "Durability",
      content: "Every Velvire frame can be repaired, whatever its age.",
    });
    const theme = externalTheme({
      id: "repairability",
      label: "repairability",
      title: "Repairability",
      content: "Every Velvire frame can be repaired, whatever its age.",
      occurrenceCount: 8,
      sourceCount: 5,
      lastSeenAt: "2025-11-01T00:00:00.000Z",
    });

    const result = analyse({
      internal: [claim],
      external: [theme],
      observations: observations("repairability", "repairability", monthlyDates("2025-01-01T00:00:00.000Z", 8, 1)),
    });

    expect(kinds(result.insights)).toContain("ALIGNED");
    expect(result.stats.matchedInternal).toBe(1);
  });

  it("calls a claim that never reached the public missing", () => {
    const claim = internalClaim({
      id: "unspoken",
      title: "Apprenticeship programme",
      content: "Velvire trains two apprentice framebuilders every year.",
    });

    const result = analyse({
      internal: [claim],
      external: [externalTheme({ label: "repairability", title: "Repairability", content: "Frames are repaired for life." })],
      observations: observations("x", "repairability", ["2025-06-01T00:00:00.000Z"]),
    });

    const missing = result.insights.find((insight) => insight.kind === "MISSING_EXTERNAL");

    expect(missing?.internalEntryIds).toEqual(["unspoken"]);
    expect(missing?.explanation).toContain("Apprenticeship programme");
  });
});

describe("drift and forgetting", () => {
  it("calls a message that has gone quiet forgotten, and says when it stopped", () => {
    const claim = internalClaim({
      id: "heritage-claim",
      category: "CREATIVE_HISTORY",
      title: "Heritage",
      content: "Velvire builds on forty years of framebuilding heritage.",
    });
    const theme = externalTheme({
      id: "heritage",
      label: "heritage",
      title: "Heritage",
      content: "Velvire builds on forty years of framebuilding heritage.",
      occurrenceCount: 6,
      sourceCount: 4,
      firstSeenAt: "2022-01-01T00:00:00.000Z",
      lastSeenAt: "2024-02-01T00:00:00.000Z",
    });

    const result = analyse({
      internal: [claim],
      external: [theme],
      observations: observations("heritage", "heritage", monthlyDates("2022-01-01T00:00:00.000Z", 6, 5)),
    });

    const forgotten = result.insights.find((insight) => insight.kind === "FORGOTTEN");

    expect(forgotten).toBeDefined();
    expect(forgotten?.evidence.lastSeenAt?.slice(0, 7)).toBe("2024-02");
    expect(forgotten?.explanation).toContain("has not appeared in the last");
  });

  it("calls a message said less often than before drifting", () => {
    const claim = internalClaim({
      id: "craft-claim",
      title: "Craft",
      content: "Every frame is welded by hand in the workshop.",
    });
    const theme = externalTheme({
      id: "craft",
      label: "craft",
      title: "Craft",
      content: "Every frame is welded by hand in the workshop.",
      occurrenceCount: 14,
      sourceCount: 6,
      firstSeenAt: "2022-01-01T00:00:00.000Z",
      lastSeenAt: "2025-06-01T00:00:00.000Z",
    });

    const result = analyse({
      internal: [claim],
      external: [theme],
      observations: [
        // Frequent for three years, then almost silent.
        ...observations("craft", "craft", monthlyDates("2022-01-01T00:00:00.000Z", 13, 3)),
        ...observations("craft-recent", "craft", ["2025-06-01T00:00:00.000Z"]).map((point) => ({
          ...point,
          entryId: "craft",
        })),
      ],
    });

    const drift = result.insights.find((insight) => insight.kind === "DRIFT");

    expect(drift).toBeDefined();
    expect(drift?.evidence.recentOccurrences).toBe(1);
    expect(drift?.evidence.earlierOccurrences).toBeGreaterThan(5);
  });
});

describe("emerging and overrepresented themes", () => {
  it("calls a rising theme with no internal counterpart emerging, and explains why", () => {
    const theme = externalTheme({
      id: "sustainability",
      kind: "STRATEGIC_THEME",
      label: "sustainability",
      title: "Sustainability",
      content: "Velvire talks about circular manufacturing and repair over replacement.",
      occurrenceCount: 17,
      sourceCount: 9,
      firstSeenAt: "2025-01-10T00:00:00.000Z",
      lastSeenAt: "2025-12-01T00:00:00.000Z",
    });

    const result = analyse({
      internal: [internalClaim({ title: "Pricing", content: "Velvire sells direct and never discounts." })],
      external: [theme],
      observations: observations(
        "sustainability",
        "sustainability",
        monthlyDates("2025-01-10T00:00:00.000Z", 12, 1),
        "STRATEGIC_THEME",
      ),
    });

    const emerging = result.insights.find((insight) => insight.kind === "EMERGING");

    expect(emerging).toBeDefined();
    expect(emerging?.externalEntryIds).toEqual(["sustainability"]);
    // The explanation has to hold the numbers, not adjectives.
    expect(emerging?.explanation).toMatch(/appears in \d+ contents from \d+ sources/);
    expect(emerging?.evidence.recentOccurrences).toBeGreaterThanOrEqual(3);
  });

  it("does not call a theme emerging when only one source carries it", () => {
    const result = analyse({
      external: [
        externalTheme({ id: "solo", label: "solo theme", occurrenceCount: 5, sourceCount: 1, firstSeenAt: "2025-06-01T00:00:00.000Z" }),
      ],
      observations: monthlyDates("2025-06-01T00:00:00.000Z", 5).map((date) => ({
        entryId: "solo",
        label: "solo theme",
        kind: "MESSAGE" as const,
        sourceId: "one-source",
        observedAt: date,
      })),
    });

    expect(kinds(result.insights)).not.toContain("EMERGING");
  });

  it("calls a theme that dominates public communication overrepresented", () => {
    const dominant = externalTheme({
      id: "innovation",
      label: "innovation",
      title: "Innovation",
      content: "Velvire is presented as an innovative, cutting-edge builder.",
      occurrenceCount: 12,
      sourceCount: 6,
      firstSeenAt: "2024-01-01T00:00:00.000Z",
      lastSeenAt: "2025-11-01T00:00:00.000Z",
    });

    const result = analyse({
      internal: [internalClaim({ title: "Pricing", content: "Velvire sells direct and never discounts." })],
      external: [dominant],
      observations: observations("innovation", "innovation", monthlyDates("2024-01-01T00:00:00.000Z", 12, 2)),
    });

    const over = result.insights.find((insight) => insight.kind === "OVERREPRESENTED");

    expect(over).toBeDefined();
    expect(over?.evidence.share).toBe(1);
    expect(over?.summary).toContain("100%");
  });
});

describe("tone and positioning over time", () => {
  it("reports a tone shift with the words that moved", () => {
    const toneDocuments = [
      ...monthlyDates("2022-01-01T00:00:00.000Z", 6, 3).map((at) => ({ at, terms: ["playful", "warm"] })),
      ...monthlyDates("2025-03-01T00:00:00.000Z", 5, 2).map((at) => ({ at, terms: ["restrained", "technical"] })),
    ];

    const result = analyse({ toneDocuments });
    const tone = result.insights.find((insight) => insight.kind === "TONE_DRIFT");

    expect(tone).toBeDefined();
    expect(tone?.summary).toContain("playful");
    expect(tone?.summary).toContain("restrained");
    expect(tone?.explanation).toContain("100% → 0%");
  });

  it("stays silent when there is too little tone data to compare", () => {
    const result = analyse({
      toneDocuments: [
        { at: "2022-01-01T00:00:00.000Z", terms: ["playful"] },
        { at: "2025-06-01T00:00:00.000Z", terms: ["restrained"] },
      ],
    });

    expect(kinds(result.insights)).not.toContain("TONE_DRIFT");
  });

  it("reports that external positioning moved from one set of themes to another", () => {
    const heritage = externalTheme({ id: "heritage", kind: "POSITIONING", label: "heritage" });
    const premium = externalTheme({ id: "premium", kind: "POSITIONING", label: "premium" });
    const innovation = externalTheme({ id: "innovation", kind: "POSITIONING", label: "innovation" });
    const accessible = externalTheme({ id: "accessible", kind: "POSITIONING", label: "accessible" });

    const result = analyse({
      external: [heritage, premium, innovation, accessible],
      observations: [
        ...observations("heritage", "heritage", monthlyDates("2022-01-01T00:00:00.000Z", 4, 3), "POSITIONING"),
        ...observations("premium", "premium", monthlyDates("2022-02-01T00:00:00.000Z", 3, 3), "POSITIONING"),
        ...observations("innovation", "innovation", monthlyDates("2025-03-01T00:00:00.000Z", 4, 2), "POSITIONING"),
        ...observations("accessible", "accessible", monthlyDates("2025-04-01T00:00:00.000Z", 3, 2), "POSITIONING"),
      ],
    });

    const evolution = result.insights.find((insight) => insight.kind === "POSITIONING_EVOLUTION");

    expect(evolution).toBeDefined();
    expect(evolution?.summary).toContain("heritage");
    expect(evolution?.summary).toContain("innovation");
  });
});

describe("the analysis as a whole", () => {
  it("reads a brand across four years and reports every kind of finding", () => {
    const internal = [
      internalClaim({ id: "premium", title: "Positioning", content: "Velvire is a premium, exclusive frame builder.", origin: "USER_EDITED" }),
      internalClaim({ id: "heritage", category: "CREATIVE_HISTORY", title: "Heritage", content: "Forty years of framebuilding heritage." }),
      internalClaim({ id: "apprentices", category: "VALUES", title: "Apprenticeship", content: "Two apprentice framebuilders are trained every year." }),
    ];

    const external = [
      externalTheme({ id: "accessible", kind: "POSITIONING", label: "accessible to everyone", title: "Accessible to everyone", content: "An affordable frame, accessible to everyone.", occurrenceCount: 7, sourceCount: 5, firstSeenAt: "2025-01-01T00:00:00.000Z", lastSeenAt: "2025-12-01T00:00:00.000Z" }),
      externalTheme({ id: "heritage", label: "heritage", title: "Heritage", content: "Forty years of framebuilding heritage.", occurrenceCount: 5, sourceCount: 3, firstSeenAt: "2022-01-01T00:00:00.000Z", lastSeenAt: "2024-02-01T00:00:00.000Z" }),
      externalTheme({ id: "sustainability", kind: "STRATEGIC_THEME", label: "sustainability", title: "Sustainability", content: "Circular manufacturing and repair over replacement.", occurrenceCount: 9, sourceCount: 6, firstSeenAt: "2025-02-01T00:00:00.000Z", lastSeenAt: "2025-12-01T00:00:00.000Z" }),
    ];

    const points = [
      ...observations("accessible", "accessible to everyone", monthlyDates("2025-01-01T00:00:00.000Z", 7, 1), "POSITIONING"),
      ...observations("heritage", "heritage", monthlyDates("2022-01-01T00:00:00.000Z", 5, 5)),
      ...observations("sustainability", "sustainability", monthlyDates("2025-02-01T00:00:00.000Z", 9, 1), "STRATEGIC_THEME"),
    ];

    const result = analyse({ internal, external, observations: points });
    const found = new Set(kinds(result.insights));

    expect(found.has("CONTRADICTION")).toBe(true);
    expect(found.has("FORGOTTEN")).toBe(true);
    expect(found.has("MISSING_EXTERNAL")).toBe(true);
    expect(found.has("EMERGING")).toBe(true);

    // Highest score first, so the dashboard leads with what matters.
    const scores = result.insights.map((insight) => insight.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // Every finding can explain itself.
    for (const insight of result.insights) {
      expect(insight.explanation.length).toBeGreaterThan(40);
      expect(insight.components.length).toBeGreaterThan(0);
    }
  });

  it("produces nothing at all from two empty memories", () => {
    expect(analyse({}).insights).toEqual([]);
  });
});
