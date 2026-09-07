import { describe, expect, it } from "vitest";
import {
  contradictionJudgementSchema,
  externalAnalysisSchema,
  externalFeedInputSchema,
  externalUrlInputSchema,
  ownedDomainsSchema,
  publicUrlSchema,
} from "@/lib/validation";
import { ExternalExtractionRejectedError, normalizeLabel, parseExternalAnalysis } from "@/lib/external/extraction";

const BRAND_ID = "3f0f7b1e-3a3e-4a1a-9f0a-2a5b6c7d8e9f";

const VALID_ANALYSIS = {
  summary: "Velvire opened a repair atelier in Lyon.",
  language: "en",
  narrative: "A builder that repairs what it made.",
  tone: ["restrained", "factual"],
  entries: [
    {
      kind: "MESSAGE",
      label: "repairability",
      statement: "Every Velvire frame can be repaired, whatever its age.",
      confidence: 0.9,
      excerpt: "The atelier will repair any Velvire frame, whatever its age",
    },
  ],
};

describe("structured reading of public content", () => {
  it("accepts a well formed reading", () => {
    expect(externalAnalysisSchema.parse(VALID_ANALYSIS).entries).toHaveLength(1);
  });

  it("rejects a kind the memory model does not have", () => {
    const result = externalAnalysisSchema.safeParse({
      ...VALID_ANALYSIS,
      entries: [{ ...VALID_ANALYSIS.entries[0], kind: "VIBES" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a confidence outside 0..1", () => {
    const result = externalAnalysisSchema.safeParse({
      ...VALID_ANALYSIS,
      entries: [{ ...VALID_ANALYSIS.entries[0], confidence: 1.4 }],
    });

    expect(result.success).toBe(false);
  });

  it("treats a content that says nothing about the brand as valid and empty", () => {
    expect(externalAnalysisSchema.parse({ summary: "Unrelated.", entries: [] }).entries).toHaveLength(0);
  });

  it("strips a markdown fence before parsing", () => {
    const parsed = parseExternalAnalysis("```json\n" + JSON.stringify(VALID_ANALYSIS) + "\n```");

    expect(parsed.entries[0]?.label).toBe("repairability");
  });

  it("throws instead of persisting when the model answers in prose", () => {
    expect(() => parseExternalAnalysis("Here is what the article says.")).toThrow(
      ExternalExtractionRejectedError,
    );
  });

  it("throws when the JSON parses but the shape is wrong", () => {
    expect(() => parseExternalAnalysis(JSON.stringify({ entries: [{ label: "x" }] }))).toThrow(
      ExternalExtractionRejectedError,
    );
  });
});

describe("theme labels", () => {
  it("collapses spellings of the same theme onto one key", () => {
    // Without this, the same message in nine articles becomes nine themes and
    // every count in the product is wrong.
    expect(normalizeLabel("  Sustainability ")).toBe(normalizeLabel("sustainability"));
    expect(normalizeLabel("Durabilité")).toBe(normalizeLabel("durabilite"));
    expect(normalizeLabel("premium  craftsmanship!")).toBe("premium craftsmanship");
  });

  it("keeps hyphenated themes intact", () => {
    expect(normalizeLabel("entry-level pricing")).toBe("entry-level pricing");
  });
});

describe("contradiction review", () => {
  it("accepts verdicts for the candidates it was given", () => {
    const parsed = contradictionJudgementSchema.parse({
      verdicts: [{ id: "c1", contradiction: true, confidence: 0.8, reason: "One says premium, the other accessible." }],
    });

    expect(parsed.verdicts[0]?.contradiction).toBe(true);
  });

  it("rejects a verdict with no identifier to attach it to", () => {
    const result = contradictionJudgementSchema.safeParse({
      verdicts: [{ contradiction: true, confidence: 0.8 }],
    });

    expect(result.success).toBe(false);
  });

  it("treats an empty review as valid", () => {
    expect(contradictionJudgementSchema.parse({}).verdicts).toEqual([]);
  });
});

describe("external input", () => {
  it("requires a full URL", () => {
    expect(publicUrlSchema.safeParse("velvire.com").success).toBe(false);
    expect(publicUrlSchema.safeParse("https://velvire.com/news").success).toBe(true);
  });

  it("refuses a scheme that is not http or https at the form boundary", () => {
    expect(publicUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
    expect(publicUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("refuses a brand id lifted from a path", () => {
    const result = externalUrlInputSchema.safeParse({
      brandId: "../../other-brand",
      url: "https://velvire.com/news",
    });

    expect(result.success).toBe(false);
  });

  it("defaults a watched source to manual syncing", () => {
    const parsed = externalFeedInputSchema.parse({
      brandId: BRAND_ID,
      kind: "SITEMAP",
      url: "https://velvire.com/sitemap.xml",
    });

    expect(parsed.frequency).toBe("MANUAL");
    expect(parsed.maxDocuments).toBe(25);
  });

  it("caps how much one sync can pull", () => {
    const result = externalFeedInputSchema.safeParse({
      brandId: BRAND_ID,
      kind: "CRAWL",
      url: "https://velvire.com",
      maxDocuments: 5000,
    });

    expect(result.success).toBe(false);
  });

  it("normalises owned domains however they are pasted", () => {
    expect(ownedDomainsSchema.parse("https://velvire.com/news\nnews.velvire.com, VELVIRE.fr")).toEqual([
      "velvire.com",
      "news.velvire.com",
      "velvire.fr",
    ]);
  });

  it("drops entries that are not domains", () => {
    expect(ownedDomainsSchema.parse("velvire\n  \nvelvire.com")).toEqual(["velvire.com"]);
  });
});
