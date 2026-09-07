import { describe, expect, it } from "vitest";
import {
  bucketObservations,
  classifyTrend,
  distributionDistance,
  dominantThemes,
  periodKey,
  periodLabel,
  termShift,
  themeTrajectories,
  windowStart,
} from "@/lib/external/timeline";
import { NOW, monthlyDates, observations } from "./fixtures/external";

/**
 * A brand's public communication only means something against time. These cover
 * the questions the product has to answer: what was dominant in a given year,
 * what appeared, what disappeared, what is growing.
 */

const sustainability = observations(
  "sustainability",
  "sustainability",
  monthlyDates("2025-02-01T00:00:00.000Z", 9),
);

const heritage = observations("heritage", "heritage", [
  ...monthlyDates("2022-01-01T00:00:00.000Z", 8, 3),
  "2024-02-01T00:00:00.000Z",
]);

const craft = observations("craft", "craftsmanship", monthlyDates("2022-01-01T00:00:00.000Z", 16, 3));

describe("periods", () => {
  it("buckets a date into a month, quarter or year", () => {
    expect(periodKey("2024-05-17T10:00:00.000Z", "MONTH")).toBe("2024-05");
    expect(periodKey("2024-05-17T10:00:00.000Z", "QUARTER")).toBe("2024-Q2");
    expect(periodKey("2024-05-17T10:00:00.000Z", "YEAR")).toBe("2024");
  });

  it("labels a month readably and leaves the others alone", () => {
    expect(periodLabel("2024-05", "MONTH")).toBe("May 2024");
    expect(periodLabel("2024-Q2", "QUARTER")).toBe("2024-Q2");
  });

  it("returns 'unknown' rather than guessing at an unparseable date", () => {
    expect(periodKey("not a date", "YEAR")).toBe("unknown");
  });
});

describe("bucketing", () => {
  it("fills the silent periods in between", () => {
    const buckets = bucketObservations(
      [
        ...observations("a", "a", ["2023-01-10T00:00:00.000Z"]),
        ...observations("a", "a", ["2023-04-10T00:00:00.000Z"]),
      ],
      "MONTH",
    );

    // A gap in publishing is information; a chart that skips it lies.
    expect(buckets.map((bucket) => bucket.period)).toEqual(["2023-01", "2023-02", "2023-03", "2023-04"]);
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 0, 0, 1]);
  });

  it("counts distinct sources alongside occurrences", () => {
    const buckets = bucketObservations(
      [
        { entryId: "a", label: "a", kind: "MESSAGE", sourceId: "s1", observedAt: "2024-01-01T00:00:00.000Z" },
        { entryId: "a", label: "a", kind: "MESSAGE", sourceId: "s1", observedAt: "2024-01-15T00:00:00.000Z" },
        { entryId: "a", label: "a", kind: "MESSAGE", sourceId: "s2", observedAt: "2024-01-20T00:00:00.000Z" },
      ],
      "MONTH",
    );

    expect(buckets[0]).toMatchObject({ count: 3, sourceCount: 2 });
  });

  it("returns nothing for no observations", () => {
    expect(bucketObservations([], "YEAR")).toEqual([]);
  });
});

describe("trajectories", () => {
  const trajectories = themeTrajectories([...sustainability, ...heritage, ...craft], {
    now: NOW,
    windowMonths: 12,
    granularity: "QUARTER",
  });

  const byId = new Map(trajectories.map((trajectory) => [trajectory.entryId, trajectory]));

  it("calls a theme with no earlier history new", () => {
    expect(byId.get("sustainability")?.trend).toBe("NEW");
    expect(byId.get("sustainability")?.earlierCount).toBe(0);
  });

  it("calls a theme with nothing in the window dormant", () => {
    expect(byId.get("heritage")?.trend).toBe("DORMANT");
    expect(byId.get("heritage")?.recentCount).toBe(0);
    expect(byId.get("heritage")?.lastSeenAt.slice(0, 7)).toBe("2024-02");
  });

  it("calls a steadily repeated theme stable", () => {
    expect(byId.get("craft")?.trend).toBe("STABLE");
  });

  it("records when a theme was first and last said", () => {
    expect(byId.get("sustainability")?.firstSeenAt.slice(0, 7)).toBe("2025-02");
    expect(byId.get("sustainability")?.lastSeenAt.slice(0, 7)).toBe("2025-10");
  });

  it("does not read a mention just before the window as history to compare against", () => {
    // One mention a week before the window opens is the same arrival as the
    // ones inside it, not a baseline that makes the theme look merely stable.
    const arriving = themeTrajectories(
      observations("new-theme", "new theme", [
        "2025-01-08T00:00:00.000Z",
        ...monthlyDates("2025-02-01T00:00:00.000Z", 8),
      ]),
      { now: NOW, windowMonths: 12 },
    );

    expect(arriving[0]?.trend).toBe("NEW");
  });

  it("compares rates rather than raw counts across unequal windows", () => {
    expect(classifyTrend(10, 4, 1.0, 0.2)).toBe("RISING");
    expect(classifyTrend(2, 40, 0.2, 1.5)).toBe("FALLING");
    expect(classifyTrend(6, 12, 0.5, 0.5)).toBe("STABLE");
    expect(classifyTrend(3, 0, 0.3, 0)).toBe("NEW");
    expect(classifyTrend(0, 9, 0, 0.4)).toBe("DORMANT");
  });
});

describe("dominant themes in a period", () => {
  it("answers what carried a given year", () => {
    const dominant = dominantThemes([...sustainability, ...heritage, ...craft], "2025", "YEAR");

    expect(dominant[0]?.label).toBe("sustainability");
    expect(dominant[0]?.count).toBe(9);
    expect(dominant[0]?.share).toBeGreaterThan(0.5);
  });

  it("answers what carried an earlier year differently", () => {
    const dominant = dominantThemes([...sustainability, ...heritage, ...craft], "2022", "YEAR");

    expect(dominant.map((theme) => theme.label).sort()).toEqual(["craftsmanship", "heritage"]);
  });

  it("returns nothing for a silent period", () => {
    expect(dominantThemes(sustainability, "2019", "YEAR")).toEqual([]);
  });
});

describe("tone over time", () => {
  const cutoff = windowStart(NOW, 12);

  const documents = [
    { at: "2022-03-01T00:00:00.000Z", terms: ["playful", "warm"] },
    { at: "2022-09-01T00:00:00.000Z", terms: ["playful", "warm"] },
    { at: "2023-03-01T00:00:00.000Z", terms: ["playful", "confident"] },
    { at: "2023-09-01T00:00:00.000Z", terms: ["playful"] },
    { at: "2025-03-01T00:00:00.000Z", terms: ["restrained", "confident"] },
    { at: "2025-06-01T00:00:00.000Z", terms: ["restrained", "technical"] },
    { at: "2025-09-01T00:00:00.000Z", terms: ["restrained", "confident"] },
    { at: "2025-11-01T00:00:00.000Z", terms: ["restrained"] },
  ];

  it("measures each word as a share of its own window", () => {
    const shifts = new Map(termShift(documents, cutoff).map((shift) => [shift.term, shift]));

    expect(shifts.get("playful")?.earlier).toBe(1);
    expect(shifts.get("playful")?.recent).toBe(0);
    expect(shifts.get("restrained")?.recent).toBe(1);
    expect(shifts.get("restrained")?.earlier).toBe(0);
  });

  it("orders by how far a word moved, in either direction", () => {
    const shifts = termShift(documents, cutoff);

    expect([shifts[0]?.term, shifts[1]?.term].sort()).toEqual(["playful", "restrained"]);
  });

  it("summarises the whole shift as one distance", () => {
    expect(distributionDistance(termShift(documents, cutoff))).toBeGreaterThan(0.5);
  });

  it("refuses to compare when one side of the window is empty", () => {
    // Otherwise every word would read as having vanished, which says something
    // about the corpus rather than about the tone.
    expect(termShift(documents.slice(0, 4), cutoff)).toEqual([]);
    expect(distributionDistance(termShift(documents.slice(0, 4), cutoff))).toBe(0);
  });

  it("counts a word once per content, however often it is repeated", () => {
    const shifts = termShift(
      [
        { at: "2022-01-01T00:00:00.000Z", terms: ["warm"] },
        { at: "2025-06-01T00:00:00.000Z", terms: ["bold", "bold", "BOLD"] },
      ],
      cutoff,
    );

    expect(shifts.find((shift) => shift.term === "bold")?.recent).toBe(1);
  });
});
