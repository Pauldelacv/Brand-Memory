import { describe, expect, it } from "vitest";
import { brandAnalysisSchema, brandInputSchema, generateInputSchema } from "@/lib/validation";
import { ExtractionRejectedError, parseAnalysis } from "@/lib/ingestion/memory";

describe("AI structured output", () => {
  const valid = {
    entries: [
      {
        category: "VOICE",
        title: "Tone of voice",
        content: "Confident and restrained.",
        confidence: 0.8,
        evidence: [{ chunkId: "chunk-1", excerpt: "we speak with restraint" }],
      },
    ],
  };

  it("accepts a well formed analysis", () => {
    expect(brandAnalysisSchema.parse(valid).entries).toHaveLength(1);
  });

  it("rejects an unknown category rather than storing it", () => {
    const result = brandAnalysisSchema.safeParse({
      entries: [{ ...valid.entries[0], category: "VIBES" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a confidence outside 0..1", () => {
    const result = brandAnalysisSchema.safeParse({
      entries: [{ ...valid.entries[0], confidence: 4 }],
    });

    expect(result.success).toBe(false);
  });

  it("treats an empty extraction as valid", () => {
    expect(brandAnalysisSchema.parse({ entries: [] }).entries).toHaveLength(0);
  });

  it("strips a markdown fence before parsing", () => {
    const parsed = parseAnalysis("```json\n" + JSON.stringify(valid) + "\n```");
    expect(parsed.entries[0]?.title).toBe("Tone of voice");
  });

  it("throws instead of persisting when the model returns prose", () => {
    expect(() => parseAnalysis("Sure! Here is the analysis.")).toThrow(ExtractionRejectedError);
  });

  it("throws when the JSON parses but does not match the schema", () => {
    expect(() => parseAnalysis(JSON.stringify({ entries: [{ title: "Tone" }] }))).toThrow(
      ExtractionRejectedError,
    );
  });
});

describe("form input", () => {
  it("requires a brand name", () => {
    expect(brandInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("normalises empty optional fields to null", () => {
    const parsed = brandInputSchema.parse({ name: "Northbound", website: "", audience: "" });

    expect(parsed.website).toBeNull();
    expect(parsed.audience).toBeNull();
  });

  it("rejects a website that is not a URL", () => {
    expect(brandInputSchema.safeParse({ name: "Northbound", website: "northbound" }).success).toBe(
      false,
    );
  });

  it("rejects a generation request with a non-uuid brand id", () => {
    const result = generateInputSchema.safeParse({
      brandId: "../../other-brand",
      prompt: "What is our tone?",
    });

    expect(result.success).toBe(false);
  });

  it("defaults the generation mode to ASK", () => {
    const parsed = generateInputSchema.parse({
      brandId: "3f0f7b1e-3a3e-4a1a-9f0a-2a5b6c7d8e9f",
      prompt: "What is our tone?",
    });

    expect(parsed.mode).toBe("ASK");
  });
});
