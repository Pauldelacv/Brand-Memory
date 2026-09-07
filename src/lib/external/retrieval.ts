import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/db/queries";
import type { RetrievalCandidate } from "@/lib/ai/ranking";
import type { MatchedExternalChunkRow, MatchedExternalMemoryRow } from "@/types/database";

/**
 * Vector search over the external half, returned in the same candidate shape as
 * the internal half so both go through one ranking pass and one context budget.
 */

export interface ExternalRetrievalOptions {
  memoryMatches?: number;
  chunkMatches?: number;
  minSimilarity?: number;
}

interface ChunkMetadata {
  title?: unknown;
  publisher?: unknown;
  url?: unknown;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function retrieveExternalCandidates(
  supabase: SupabaseClient,
  brandId: string,
  embedding: number[],
  options: ExternalRetrievalOptions = {},
): Promise<RetrievalCandidate[]> {
  const [memoryResult, chunkResult] = await Promise.all([
    supabase.rpc("match_external_memory_entries", {
      p_brand_id: brandId,
      p_query_embedding: embedding,
      p_match_count: options.memoryMatches ?? 6,
      p_min_similarity: options.minSimilarity ?? 0.1,
    }),
    supabase.rpc("match_external_chunks", {
      p_brand_id: brandId,
      p_query_embedding: embedding,
      p_match_count: options.chunkMatches ?? 8,
      p_min_similarity: options.minSimilarity ?? 0.1,
    }),
  ]);

  if (memoryResult.error) {
    throw new DatabaseError("External memory search failed.", memoryResult.error);
  }
  if (chunkResult.error) {
    throw new DatabaseError("Published content search failed.", chunkResult.error);
  }

  const themes = (memoryResult.data as MatchedExternalMemoryRow[]).map(
    (row): RetrievalCandidate => ({
      kind: "EXTERNAL_MEMORY",
      refId: row.id,
      label: row.title,
      // The counts belong in the context: "said 12 times across 7 sources" is
      // what separates a recurring position from a one-off quote.
      content: `${row.content} (said in ${row.occurrence_count} public content${
        row.occurrence_count === 1 ? "" : "s"
      } across ${row.source_count} source${row.source_count === 1 ? "" : "s"}${
        row.first_seen_at ? `, from ${row.first_seen_at.slice(0, 10)}` : ""
      }${row.last_seen_at ? ` to ${row.last_seen_at.slice(0, 10)}` : ""})`,
      similarity: row.similarity,
      sourceId: null,
      sourceName: null,
      category: null,
      origin: null,
      authoritative: false,
      sourceDate: null,
      priority: 0,
      updatedAt: row.updated_at,
      url: null,
      publishedAt: row.last_seen_at,
    }),
  );

  const passages = (chunkResult.data as MatchedExternalChunkRow[]).map((row): RetrievalCandidate => {
    const metadata = (row.metadata ?? {}) as ChunkMetadata;
    const title = readString(metadata.title);
    const publisher = readString(metadata.publisher);

    return {
      kind: "EXTERNAL_DOCUMENT",
      refId: row.id,
      label: title ?? publisher ?? "Published content",
      content: row.content,
      similarity: row.similarity,
      sourceId: row.source_id,
      sourceName: publisher ?? title,
      category: null,
      origin: null,
      authoritative: false,
      sourceDate: null,
      priority: 0,
      updatedAt: null,
      url: readString(metadata.url),
      publishedAt: row.published_at,
    };
  });

  return [...themes, ...passages];
}
