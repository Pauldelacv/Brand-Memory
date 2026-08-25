/**
 * Embeddings are stored in a fixed-width pgvector column, so every provider
 * must agree on this dimension. Changing it requires a schema migration.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export class EmbeddingDimensionError extends Error {
  constructor(received: number) {
    super(
      `Embedding has ${received} dimensions but the database expects ${EMBEDDING_DIMENSIONS}. ` +
        "Check AI_EMBEDDING_PROVIDER and AI_EMBEDDING_MODEL.",
    );
    this.name = "EmbeddingDimensionError";
  }
}

export function assertEmbedding(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingDimensionError(vector.length);
  }
  return vector;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
