import { AICapabilityError } from "@/lib/ai/types";
import type { AIProvider } from "@/lib/ai/types";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

/**
 * Deterministic hashed bag-of-words embeddings. No network, no API key.
 *
 * This exists so the ingestion pipeline and retrieval ranking can be developed
 * and tested without a vendor account. Recall is far below a real embedding
 * model — do not use it in production.
 */
export function createLocalProvider(): AIProvider {
  return {
    name: "local",

    async generateEmbedding(input: string): Promise<number[]> {
      return hashEmbedding(input);
    },

    async generateText(): Promise<never> {
      throw new AICapabilityError("local", "text generation");
    },
  };
}

export function hashEmbedding(input: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const token of tokens) {
    const bucket = fnv1a(token) % EMBEDDING_DIMENSIONS;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
