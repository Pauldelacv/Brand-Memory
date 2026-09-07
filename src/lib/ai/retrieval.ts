import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchedChunkRow, MatchedMemoryRow } from "@/types/database";
import { getAIProvider } from "@/lib/ai";
import { buildBrandContext } from "@/lib/ai/ranking";
import type { BrandContext, RetrievalCandidate } from "@/lib/ai/ranking";
import { DatabaseError } from "@/lib/db/queries";
import { retrieveExternalCandidates } from "@/lib/external/retrieval";

/**
 * Retrieval, in the order the product spec lays out:
 *   embed the query -> search structured memory -> search document chunks ->
 *   combine, rank, resolve contradictions -> build a selective context.
 *
 * The external memory is searched in the same pass. Public communication is
 * labelled as such in the context and never competes for an internal claim
 * slot, so an answer can say "the guidelines say X, and here is what you
 * actually published" instead of quietly picking one.
 */

export interface RetrievalOptions {
  memoryMatches?: number;
  chunkMatches?: number;
  minSimilarity?: number;
  tokenBudget?: number;
  /** Set to false to answer purely from the brand's own material. */
  includeExternal?: boolean;
  externalMemoryMatches?: number;
  externalChunkMatches?: number;
}

interface SourceMeta {
  filename: string;
  authoritative: boolean;
  priority: number;
  sourceDate: string | null;
}

async function loadSourceMeta(
  supabase: SupabaseClient,
  brandId: string,
): Promise<Map<string, SourceMeta>> {
  const { data, error } = await supabase
    .from("brand_sources")
    .select("id, filename, authoritative, priority, source_date")
    .eq("brand_id", brandId);

  if (error) throw new DatabaseError("Could not load source metadata for retrieval.", error);

  const map = new Map<string, SourceMeta>();
  for (const row of data as Array<{
    id: string;
    filename: string;
    authoritative: boolean;
    priority: number;
    source_date: string | null;
  }>) {
    map.set(row.id, {
      filename: row.filename,
      authoritative: row.authoritative,
      priority: row.priority,
      sourceDate: row.source_date,
    });
  }
  return map;
}

export async function retrieveBrandContext(
  supabase: SupabaseClient,
  brandId: string,
  query: string,
  options: RetrievalOptions = {},
): Promise<BrandContext> {
  const provider = getAIProvider();
  const embedding = await provider.generateEmbedding(query);

  const includeExternal = options.includeExternal !== false;

  const [memoryResult, chunkResult, sourceMeta, externalCandidates] = await Promise.all([
    supabase.rpc("match_memory_entries", {
      p_brand_id: brandId,
      p_query_embedding: embedding,
      p_match_count: options.memoryMatches ?? 8,
      p_min_similarity: options.minSimilarity ?? 0.1,
    }),
    supabase.rpc("match_document_chunks", {
      p_brand_id: brandId,
      p_query_embedding: embedding,
      p_match_count: options.chunkMatches ?? 12,
      p_min_similarity: options.minSimilarity ?? 0.1,
    }),
    loadSourceMeta(supabase, brandId),
    includeExternal
      ? retrieveExternalCandidates(supabase, brandId, embedding, {
          memoryMatches: options.externalMemoryMatches ?? 6,
          chunkMatches: options.externalChunkMatches ?? 8,
          minSimilarity: options.minSimilarity ?? 0.1,
        })
      : Promise.resolve([]),
  ]);

  if (memoryResult.error) {
    throw new DatabaseError("Brand memory search failed.", memoryResult.error);
  }
  if (chunkResult.error) {
    throw new DatabaseError("Document search failed.", chunkResult.error);
  }

  const candidates: RetrievalCandidate[] = [
    ...(memoryResult.data as MatchedMemoryRow[]).map(
      (row): RetrievalCandidate => ({
        kind: "MEMORY",
        refId: row.id,
        label: row.title,
        content: row.content,
        similarity: row.similarity,
        sourceId: null,
        sourceName: null,
        category: row.category,
        origin: row.origin,
        authoritative: false,
        sourceDate: null,
        priority: 0,
        updatedAt: row.updated_at,
      }),
    ),
    ...(chunkResult.data as MatchedChunkRow[]).map((row): RetrievalCandidate => {
      const meta = sourceMeta.get(row.source_id);
      return {
        kind: "DOCUMENT",
        refId: row.id,
        label: meta?.filename ?? "Document",
        content: row.content,
        similarity: row.similarity,
        sourceId: row.source_id,
        sourceName: meta?.filename ?? null,
        category: null,
        origin: null,
        authoritative: meta?.authoritative ?? false,
        sourceDate: meta?.sourceDate ?? null,
        priority: meta?.priority ?? 0,
        updatedAt: null,
      };
    }),
    ...externalCandidates,
  ];

  return buildBrandContext(candidates, { tokenBudget: options.tokenBudget });
}
