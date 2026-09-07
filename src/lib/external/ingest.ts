import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "@/lib/ai";
import { chunkText } from "@/lib/ingestion/chunk";
import { DatabaseError } from "@/lib/db/queries";
import { getConnector } from "@/lib/external/connectors";
import { normalizeDocument } from "@/lib/external/connectors/base";
import { contentHash, findDuplicate, suppressesContent } from "@/lib/external/dedupe";
import type { DuplicateCandidate, DuplicateVerdict } from "@/lib/external/dedupe";
import { FetchError, getHtmlFetcher } from "@/lib/external/fetcher";
import { classifyMedia, normalizeUrl, resolveCanonicalUrl, urlHash, UnsafeUrlError } from "@/lib/external/url";
import { extractExternalMemoryForSource } from "@/lib/external/extraction";
import type { Brand } from "@/types/domain";
import type {
  ExternalFeed,
  ExternalMediaClass,
  ExternalSourceType,
  ExternalStatus,
} from "@/types/external";
import type { DiscoveredItem } from "@/lib/external/connectors/types";

/**
 * The external ingestion pipeline:
 *
 *   DISCOVER → FETCH → NORMALISE → DEDUPLICATE → STORE → CHUNK → EMBED → EXTRACT → READY
 *
 * It runs with a service-role client, so the caller MUST have verified that the
 * signed-in user owns the brand before invoking any of this. Every failure ends
 * up on the source row with a message a person can act on; nothing is swallowed.
 */

/** How many stored contents a new one is compared against for deduplication. */
const DEDUPE_CANDIDATE_LIMIT = 40;
/** Below this, there is no article: a cookie wall, a redirect stub, a 404 page. */
const MIN_WORDS = 60;

export interface IngestResult {
  sourceId: string | null;
  url: string;
  status: ExternalStatus;
  chunkCount: number;
  entryCount: number;
  duplicateOf?: string | null;
  error?: string;
}

export interface SyncResult {
  discovered: number;
  ingested: number;
  duplicates: number;
  failed: number;
  notes: string[];
  results: IngestResult[];
}

export class ExternalIngestionError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "ExternalIngestionError";
  }
}

async function loadKnownUrlHashes(admin: SupabaseClient, brandId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("external_sources")
    .select("url_hash")
    .eq("brand_id", brandId);

  if (error) throw new DatabaseError("Could not read the known external URLs.", error);
  return new Set((data ?? []).map((row) => (row as { url_hash: string }).url_hash));
}

/**
 * Creates the source row, or returns the existing one for the same normalised
 * URL. The unique index on (brand_id, url_hash) is what makes a re-sync cheap.
 */
export async function registerExternalSource(
  admin: SupabaseClient,
  brand: Brand,
  item: DiscoveredItem,
  feedId: string | null,
): Promise<string> {
  const url = normalizeUrl(item.url);
  const hash = urlHash(url);

  const { data: existing, error: lookupError } = await admin
    .from("external_sources")
    .select("id")
    .eq("brand_id", brand.id)
    .eq("url_hash", hash)
    .maybeSingle();

  if (lookupError) throw new DatabaseError("Could not check for an existing source.", lookupError);
  if (existing) return (existing as { id: string }).id;

  const { data, error } = await admin
    .from("external_sources")
    .insert({
      brand_id: brand.id,
      feed_id: feedId,
      source_type: item.sourceType,
      media_class: classifyMedia(url, brand.ownedDomains, brand.website),
      url,
      url_hash: hash,
      status: "DISCOVERED",
      metadata: {
        discoveredTitle: item.title,
        discoveredPublisher: item.publisher,
        discoveredSummary: item.summary,
        discoveredPublishedAt: item.publishedAt,
      },
    })
    .select("id")
    .single();

  if (error || !data) throw new DatabaseError("The external source could not be recorded.", error);
  return (data as { id: string }).id;
}

async function loadDedupeCandidates(
  admin: SupabaseClient,
  brandId: string,
  excludeSourceId: string,
): Promise<DuplicateCandidate[]> {
  const { data: contents, error: contentError } = await admin
    .from("external_contents")
    .select("source_id, body, publisher, published_at")
    .eq("brand_id", brandId)
    .order("extracted_at", { ascending: false })
    .limit(DEDUPE_CANDIDATE_LIMIT);

  if (contentError) throw new DatabaseError("Could not read the stored external contents.", contentError);

  const rows = ((contents ?? []) as Array<{
    source_id: string;
    body: string;
    publisher: string | null;
    published_at: string | null;
  }>).filter((row) => row.source_id !== excludeSourceId);

  if (rows.length === 0) return [];

  const { data: sources, error: sourceError } = await admin
    .from("external_sources")
    .select("id, canonical_url, content_hash, source_type, media_class")
    .eq("brand_id", brandId)
    .in("id", rows.map((row) => row.source_id));

  if (sourceError) throw new DatabaseError("Could not read the stored external sources.", sourceError);

  const meta = new Map(
    ((sources ?? []) as Array<{
      id: string;
      canonical_url: string | null;
      content_hash: string | null;
      source_type: ExternalSourceType;
      media_class: ExternalMediaClass;
    }>).map((row) => [row.id, row]),
  );

  const candidates: DuplicateCandidate[] = [];
  for (const row of rows) {
    const source = meta.get(row.source_id);
    if (!source) continue;
    candidates.push({
      sourceId: row.source_id,
      canonicalUrl: source.canonical_url,
      contentHash: source.content_hash,
      text: row.body,
      publisher: row.publisher,
      sourceType: source.source_type,
      mediaClass: source.media_class,
      publishedAt: row.published_at,
    });
  }

  return candidates;
}

export interface ProcessOptions {
  /** Skip the LLM pass. Used when re-fetching only to refresh the text. */
  extractMemory?: boolean;
}

/**
 * Fetches one registered source and turns it into stored, searchable content.
 * Returns rather than throws: a single unreachable page must not abort a sync.
 */
export async function processExternalSource(
  admin: SupabaseClient,
  brand: Brand,
  sourceId: string,
  options: ProcessOptions = {},
): Promise<IngestResult> {
  const { data: row, error: loadError } = await admin
    .from("external_sources")
    .select("id, url, feed_id, source_type, media_class")
    .eq("id", sourceId)
    .eq("brand_id", brand.id)
    .maybeSingle();

  if (loadError || !row) {
    return {
      sourceId,
      url: "",
      status: "FAILED",
      chunkCount: 0,
      entryCount: 0,
      error: "The external source record could not be loaded.",
    };
  }

  const source = row as { id: string; url: string; source_type: ExternalSourceType };

  await admin
    .from("external_sources")
    .update({ status: "FETCHING", extraction_error: null })
    .eq("id", sourceId);

  try {
    const document = await getHtmlFetcher().fetch(source.url);
    const normalized = normalizeDocument(document, brand.ownedDomains);

    if (normalized.wordCount < MIN_WORDS) {
      throw new ExternalIngestionError(
        `Only ${normalized.wordCount} words could be read from this page. It may be a listing, a paywall or a redirect.`,
      );
    }

    await admin.from("external_sources").update({ status: "PROCESSING" }).eq("id", sourceId);

    const canonicalUrl = resolveCanonicalUrl(normalized.canonicalUrl, document.url);
    const hash = contentHash(normalized.body);
    const mediaClass = classifyMedia(document.url, brand.ownedDomains, brand.website);

    const candidate: DuplicateCandidate = {
      sourceId,
      canonicalUrl,
      contentHash: hash,
      text: normalized.body,
      publisher: normalized.publisher,
      sourceType: normalized.sourceType,
      mediaClass,
      publishedAt: normalized.publishedAt,
    };

    const stored = await loadDedupeCandidates(admin, brand.id, sourceId);
    const verdict: DuplicateVerdict = findDuplicate(candidate, stored);

    const publishedAt = normalized.publishedAt;

    const { error: contentError } = await admin
      .from("external_contents")
      .upsert(
        {
          brand_id: brand.id,
          source_id: sourceId,
          title: normalized.title.slice(0, 500),
          body: normalized.body,
          summary: normalized.description.slice(0, 1000),
          author: normalized.author,
          publisher: normalized.publisher,
          published_at: publishedAt,
          language: normalized.language,
          images: normalized.images,
          word_count: normalized.wordCount,
          metadata: {
            schemaType: normalized.schemaType,
            byteSize: document.byteSize,
            fetchedFrom: document.url,
          },
          extracted_at: new Date().toISOString(),
        },
        { onConflict: "source_id" },
      );

    if (contentError) {
      throw new ExternalIngestionError("The normalised content could not be stored.", contentError);
    }

    const suppressed = suppressesContent(verdict.kind);

    await admin
      .from("external_sources")
      .update({
        source_type: normalized.sourceType,
        media_class: mediaClass,
        canonical_url: canonicalUrl,
        content_hash: hash,
        duplicate_of: verdict.matchedSourceId,
        duplicate_kind: verdict.kind === "DISTINCT" ? null : verdict.kind,
        duplicate_similarity: verdict.kind === "DISTINCT" ? null : verdict.similarity,
        fetched_at: new Date().toISOString(),
      })
      .eq("id", sourceId);

    if (suppressed) {
      // The content is kept and readable, but it never re-enters retrieval or
      // theme counting: one release covered nine times is one message.
      await admin.from("external_chunks").delete().eq("source_id", sourceId);
      await admin
        .from("external_sources")
        .update({
          status: "DUPLICATE",
          extraction_error: verdict.reason,
          chunk_count: 0,
          processed_at: new Date().toISOString(),
        })
        .eq("id", sourceId);

      return {
        sourceId,
        url: source.url,
        status: "DUPLICATE",
        chunkCount: 0,
        entryCount: 0,
        duplicateOf: verdict.matchedSourceId,
      };
    }

    const chunkCount = await storeChunks(admin, brand.id, sourceId, normalized.body, {
      title: normalized.title,
      publisher: normalized.publisher,
      url: document.url,
      publishedAt,
    });

    await admin
      .from("external_sources")
      .update({
        status: "READY",
        extraction_error: null,
        chunk_count: chunkCount,
        processed_at: new Date().toISOString(),
      })
      .eq("id", sourceId);

    let entryCount = 0;
    if (options.extractMemory !== false) {
      const extraction = await extractExternalMemoryForSource(admin, brand, sourceId);
      entryCount = extraction.recorded;
      if (extraction.error) {
        // Retrieval works; only the structured layer is missing. Say so on the row.
        await admin
          .from("external_sources")
          .update({ extraction_error: extraction.error })
          .eq("id", sourceId);
      }
    }

    return { sourceId, url: source.url, status: "READY", chunkCount, entryCount };
  } catch (error) {
    const message = describeIngestFailure(error);
    await admin
      .from("external_sources")
      .update({ status: "FAILED", extraction_error: message, chunk_count: 0 })
      .eq("id", sourceId);

    return { sourceId, url: source.url, status: "FAILED", chunkCount: 0, entryCount: 0, error: message };
  }
}

async function storeChunks(
  admin: SupabaseClient,
  brandId: string,
  sourceId: string,
  body: string,
  metadata: { title: string; publisher: string | null; url: string; publishedAt: string | null },
): Promise<number> {
  const chunks = chunkText(body);
  if (chunks.length === 0) {
    throw new ExternalIngestionError("No usable text was found in this page.");
  }

  const provider = getAIProvider();
  const embeddings: number[][] = new Array(chunks.length);

  for (let start = 0; start < chunks.length; start += 4) {
    const slice = chunks.slice(start, start + 4);
    const embedded = await Promise.all(
      slice.map((chunk) => provider.generateEmbedding(chunk.content)),
    );
    embedded.forEach((vector, offset) => {
      embeddings[start + offset] = vector;
    });
  }

  await admin.from("external_chunks").delete().eq("source_id", sourceId);

  const { error } = await admin.from("external_chunks").insert(
    chunks.map((chunk, index) => ({
      source_id: sourceId,
      brand_id: brandId,
      chunk_index: chunk.index,
      content: chunk.content,
      token_estimate: chunk.tokenEstimate,
      embedding: embeddings[index] ?? null,
      published_at: metadata.publishedAt,
      metadata: {
        title: metadata.title,
        publisher: metadata.publisher,
        url: metadata.url,
      },
    })),
  );

  if (error) throw new ExternalIngestionError("The extracted text could not be stored.", error);
  return chunks.length;
}

/**
 * Discovers new URLs behind a watched source and ingests them.
 *
 * Known URLs are skipped before anything is fetched, so a daily sync of a large
 * sitemap costs one request plus the new documents.
 */
export async function syncFeed(
  admin: SupabaseClient,
  brand: Brand,
  feed: ExternalFeed,
): Promise<SyncResult> {
  const connector = getConnector(feed.kind);
  const knownUrlHashes = await loadKnownUrlHashes(admin, brand.id);

  let discovery;
  try {
    discovery = await connector.discover({
      target: feed.url,
      maxDocuments: feed.maxDocuments,
      knownUrlHashes,
      fetcher: getHtmlFetcher(),
      ownedDomains: brand.ownedDomains,
    });
  } catch (error) {
    const message = describeIngestFailure(error);
    await admin
      .from("external_feeds")
      .update({ last_error: message, last_synced_at: new Date().toISOString() })
      .eq("id", feed.id);

    throw new ExternalIngestionError(message, error);
  }

  const results: IngestResult[] = [];

  for (const item of discovery.items) {
    try {
      const sourceId = await registerExternalSource(admin, brand, item, feed.id);
      results.push(await processExternalSource(admin, brand, sourceId));
    } catch (error) {
      results.push({
        sourceId: null,
        url: item.url,
        status: "FAILED",
        chunkCount: 0,
        entryCount: 0,
        error: describeIngestFailure(error),
      });
    }
  }

  const ingested = results.filter((result) => result.status === "READY").length;
  const duplicates = results.filter((result) => result.status === "DUPLICATE").length;
  const failed = results.filter((result) => result.status === "FAILED").length;

  await admin
    .from("external_feeds")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: failed > 0 ? `${failed} of ${results.length} contents could not be read.` : null,
      discovered_count: feed.discoveredCount + ingested,
    })
    .eq("id", feed.id);

  return {
    discovered: discovery.items.length,
    ingested,
    duplicates,
    failed,
    notes: discovery.notes,
    results,
  };
}

export function describeIngestFailure(error: unknown): string {
  if (error instanceof UnsafeUrlError) return error.message;
  if (error instanceof FetchError) return error.message;
  if (error instanceof ExternalIngestionError) return error.message;
  if (error instanceof DatabaseError) return error.message;
  if (error instanceof Error) return error.message;
  return "This content could not be read.";
}
