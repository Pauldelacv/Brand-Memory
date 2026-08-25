import { describe, expect, it } from "vitest";
import { chunkText, normalizeWhitespace } from "@/lib/ingestion/chunk";

describe("chunking", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    const chunks = chunkText("The brand speaks with confidence and restraint.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(0);
  });

  it("splits a long document and numbers the chunks in order", () => {
    const paragraph = "Brand positioning statement. ".repeat(40);
    const chunks = chunkText([paragraph, paragraph, paragraph].join("\n\n"), { maxChars: 500 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
  });

  it("respects the character budget even for one unbroken sentence", () => {
    const chunks = chunkText("x".repeat(5000), { maxChars: 400, overlapChars: 0 });

    expect(chunks.every((chunk) => chunk.content.length <= 400)).toBe(true);
  });

  it("carries overlap so a claim split across chunks keeps its context", () => {
    const text = Array.from({ length: 12 }, (_, index) => `Paragraph ${index} about the brand voice.`).join(
      "\n\n",
    );
    const chunks = chunkText(text, { maxChars: 120, overlapChars: 40 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]?.content.length).toBeGreaterThan(0);
  });

  it("estimates tokens for every chunk", () => {
    const chunks = chunkText("Confidence and restraint define the brand.");

    expect(chunks[0]?.tokenEstimate).toBeGreaterThan(0);
  });

  it("collapses stray whitespace without touching paragraph breaks", () => {
    expect(normalizeWhitespace("a  b\r\n\r\n\r\nc")).toBe("a b\n\nc");
  });
});
