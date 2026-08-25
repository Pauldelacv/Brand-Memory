/**
 * Splits extracted text into retrieval-sized pieces.
 *
 * Paragraph boundaries are respected where possible so a chunk stays readable
 * when it is shown back to the user as evidence.
 */

export interface Chunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

export interface ChunkOptions {
  /** Target size in characters. ~1000 chars is roughly 250 tokens. */
  maxChars?: number;
  /** Characters repeated from the previous chunk to preserve context. */
  overlapChars?: number;
  minChars?: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(input: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 1200;
  const overlapChars = options.overlapChars ?? 150;
  const minChars = options.minChars ?? 40;

  const text = normalizeWhitespace(input);
  if (!text) return [];

  const paragraphs = text.split(/\n{2,}/).flatMap((paragraph) => splitLongParagraph(paragraph, maxChars));

  const chunks: Chunk[] = [];
  let buffer = "";

  const flush = () => {
    const content = buffer.trim();
    if (content.length >= minChars || (content.length > 0 && chunks.length === 0)) {
      chunks.push({
        index: chunks.length,
        content,
        tokenEstimate: estimateTokens(content),
      });
    }
    buffer = overlapChars > 0 ? content.slice(-overlapChars) : "";
  };

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && buffer) {
      flush();
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim()) {
    const content = buffer.trim();
    chunks.push({ index: chunks.length, content, tokenEstimate: estimateTokens(content) });
  }

  return chunks;
}

/** A single paragraph longer than the budget is cut on sentence boundaries. */
function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const trimmed = paragraph.trim();
  if (trimmed.length <= maxChars) return trimmed ? [trimmed] : [];

  const sentences = trimmed.match(/[^.!?\n]+[.!?]*\s*/g) ?? [trimmed];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current) {
      parts.push(current.trim());
      current = "";
    }
    // A single sentence can still exceed the budget; cut it hard.
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) {
        parts.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    current += sentence;
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}
