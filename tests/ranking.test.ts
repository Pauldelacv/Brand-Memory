import { describe, expect, it } from "vitest";
import {
  AUTHORITY_TIERS,
  authorityTier,
  buildBrandContext,
  dedupe,
  resolveConflicts,
  scoreCandidate,
} from "@/lib/ai/ranking";
import { candidate, memoryCandidate } from "./helpers";

describe("authority ladder", () => {
  it("ranks a user-edited memory entry above everything else", () => {
    expect(authorityTier(memoryCandidate({ origin: "USER_EDITED" }))).toBe(
      AUTHORITY_TIERS.USER_EDITED,
    );
    expect(authorityTier(candidate({ authoritative: true }))).toBe(AUTHORITY_TIERS.OFFICIAL_SOURCE);
    expect(authorityTier(candidate({ authoritative: false }))).toBe(AUTHORITY_TIERS.OTHER_SOURCE);
    expect(authorityTier(memoryCandidate({ origin: "AI_EXTRACTED" }))).toBe(
      AUTHORITY_TIERS.AI_INFERENCE,
    );
  });

  it("lets authority lift a weaker semantic match above a stronger one", () => {
    const official = scoreCandidate(candidate({ similarity: 0.55, authoritative: true }));
    const casual = scoreCandidate(candidate({ similarity: 0.62, authoritative: false }));

    expect(official.score).toBeGreaterThan(casual.score);
  });

  it("does not let authority override a much stronger match", () => {
    const official = scoreCandidate(candidate({ similarity: 0.3, authoritative: true }));
    const relevant = scoreCandidate(candidate({ similarity: 0.95, authoritative: false }));

    expect(relevant.score).toBeGreaterThan(official.score);
  });

  it("uses priority only as a tie-break", () => {
    const low = scoreCandidate(candidate({ similarity: 0.6, priority: 0 }));
    const high = scoreCandidate(candidate({ similarity: 0.6, priority: 10 }));

    expect(high.score).toBeGreaterThan(low.score);
    expect(high.score - low.score).toBeLessThan(0.1);
  });
});

describe("conflict resolution", () => {
  it("keeps the user-edited claim and reports the one it superseded", () => {
    const scored = [
      memoryCandidate({
        refId: "ai",
        content: "Tone is playful.",
        origin: "AI_EXTRACTED",
        similarity: 0.9,
      }),
      memoryCandidate({
        refId: "human",
        content: "Tone is confident and restrained.",
        origin: "USER_EDITED",
        similarity: 0.4,
      }),
    ].map(scoreCandidate);

    const { kept, conflicts } = resolveConflicts(scored);

    expect(kept.map((entry) => entry.refId)).toEqual(["human"]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.keptRefId).toBe("human");
    expect(conflicts[0]?.supersededSummaries[0]).toContain("playful");
  });

  it("prefers the newer claim when both carry the same authority", () => {
    const scored = [
      memoryCandidate({
        refId: "old",
        content: "Tone is playful.",
        updatedAt: "2023-01-01T00:00:00.000Z",
      }),
      memoryCandidate({
        refId: "new",
        content: "Tone is confident and restrained.",
        updatedAt: "2025-06-01T00:00:00.000Z",
      }),
    ].map(scoreCandidate);

    const { kept, conflicts } = resolveConflicts(scored);

    expect(kept.map((entry) => entry.refId)).toEqual(["new"]);
    expect(conflicts[0]?.reason).toContain("recent");
  });

  it("never merges contradictions into a single entry", () => {
    const scored = [
      memoryCandidate({ refId: "a", content: "Tone is playful." }),
      memoryCandidate({ refId: "b", content: "Tone is severe." }),
    ].map(scoreCandidate);

    const { kept } = resolveConflicts(scored);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.content).not.toContain("playful and severe");
  });

  it("treats different claim slots as independent, not as a conflict", () => {
    const scored = [
      memoryCandidate({ refId: "voice", label: "Tone of voice", content: "Confident." }),
      memoryCandidate({
        refId: "audience",
        label: "Primary audience",
        category: "AUDIENCE",
        content: "Urban commuters.",
      }),
    ].map(scoreCandidate);

    const { kept, conflicts } = resolveConflicts(scored);

    expect(kept).toHaveLength(2);
    expect(conflicts).toHaveLength(0);
  });

  it("does not report a conflict when the competing entries agree", () => {
    const scored = [
      memoryCandidate({ refId: "a", content: "Tone is confident." }),
      memoryCandidate({ refId: "b", content: "Tone is confident!" }),
    ].map(scoreCandidate);

    const { conflicts } = resolveConflicts(scored);

    expect(conflicts).toHaveLength(0);
  });
});

describe("deduplication", () => {
  it("collapses the same passage and keeps the best-scoring copy", () => {
    const scored = [
      candidate({ refId: "weak", content: "Values: craft, restraint, longevity.", similarity: 0.4 }),
      candidate({
        refId: "strong",
        content: "Values: craft, restraint, longevity.",
        similarity: 0.8,
      }),
    ].map(scoreCandidate);

    const result = dedupe(scored);

    expect(result).toHaveLength(1);
    expect(result[0]?.refId).toBe("strong");
  });
});

describe("context assembly", () => {
  it("stays inside the token budget instead of dumping every document", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      candidate({
        refId: `chunk-${index}`,
        content: "word ".repeat(400),
        similarity: 0.9 - index * 0.01,
      }),
    );

    const context = buildBrandContext(many, { tokenBudget: 1500 });

    expect(context.tokenEstimate).toBeLessThanOrEqual(1500);
    expect(context.candidates.length).toBeLessThan(many.length);
  });

  it("emits one citation per selected candidate", () => {
    const context = buildBrandContext([
      memoryCandidate({ refId: "m1", label: "Tone of voice" }),
      candidate({ refId: "d1" }),
    ]);

    expect(context.citations.map((citation) => citation.refId).sort()).toEqual(["d1", "m1"]);
    expect(context.citations.every((citation) => citation.excerpt.length > 0)).toBe(true);
  });

  it("puts detected contradictions into the context the model reads", () => {
    const context = buildBrandContext([
      memoryCandidate({ refId: "ai", content: "Tone is playful.", origin: "AI_EXTRACTED" }),
      memoryCandidate({
        refId: "human",
        content: "Tone is confident and restrained.",
        origin: "USER_EDITED",
      }),
    ]);

    expect(context.conflicts).toHaveLength(1);
    expect(context.text).toContain("CONTRADICTIONS DETECTED");
    expect(context.text).toContain("playful");
  });

  it("says so plainly when nothing was retrieved", () => {
    const context = buildBrandContext([]);

    expect(context.candidates).toHaveLength(0);
    expect(context.text).toContain("No brand knowledge");
  });
});
