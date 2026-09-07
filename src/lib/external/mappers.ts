import { scoreComponentsSchema, insightEvidenceSchema } from "@/lib/validation";
import type {
  BrandInsightRow,
  ExternalAnalysisRunRow,
  ExternalContentRow,
  ExternalFeedRow,
  ExternalMemoryEntryRow,
  ExternalObservationRow,
  ExternalSourceRow,
} from "@/types/database";
import type {
  BrandInsight,
  DuplicateKind,
  ExternalAnalysisRun,
  ExternalContent,
  ExternalFeed,
  ExternalMemoryEntry,
  ExternalObservation,
  ExternalSource,
  InsightEvidence,
  ScoreComponent,
} from "@/types/external";
import { DUPLICATE_KINDS } from "@/types/external";

/** Row shapes to domain shapes for the external half. */

/**
 * pgvector columns come back from PostgREST as the text form "[0.1,0.2,...]".
 * Cross analysis needs the numbers, so parse rather than cast.
 */
export function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "number") ? (value as number[]) : null;
  }

  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "number")) {
        return parsed as number[];
      }
    } catch {
      return null;
    }
  }

  return null;
}

function parseDuplicateKind(value: string | null): DuplicateKind | null {
  if (!value) return null;
  return (DUPLICATE_KINDS as readonly string[]).includes(value) ? (value as DuplicateKind) : null;
}

export function toExternalFeed(row: ExternalFeedRow): ExternalFeed {
  return {
    id: row.id,
    brandId: row.brand_id,
    kind: row.kind,
    url: row.url,
    label: row.label,
    enabled: row.enabled,
    frequency: row.frequency,
    maxDocuments: row.max_documents,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    discoveredCount: row.discovered_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toExternalSource(row: ExternalSourceRow): ExternalSource {
  return {
    id: row.id,
    brandId: row.brand_id,
    feedId: row.feed_id,
    sourceType: row.source_type,
    mediaClass: row.media_class,
    url: row.url,
    canonicalUrl: row.canonical_url,
    urlHash: row.url_hash,
    contentHash: row.content_hash,
    status: row.status,
    extractionError: row.extraction_error,
    duplicateOf: row.duplicate_of,
    duplicateKind: parseDuplicateKind(row.duplicate_kind),
    duplicateSimilarity: row.duplicate_similarity,
    discoveredAt: row.discovered_at,
    fetchedAt: row.fetched_at,
    processedAt: row.processed_at,
    chunkCount: row.chunk_count,
    entryCount: row.entry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toExternalContent(row: ExternalContentRow): ExternalContent {
  return {
    id: row.id,
    brandId: row.brand_id,
    sourceId: row.source_id,
    title: row.title,
    body: row.body,
    summary: row.summary,
    author: row.author,
    publisher: row.publisher,
    publishedAt: row.published_at,
    language: row.language,
    tone: row.tone ?? [],
    narrative: row.narrative,
    wordCount: row.word_count,
    extractedAt: row.extracted_at,
  };
}

export function toExternalMemoryEntry(row: ExternalMemoryEntryRow): ExternalMemoryEntry {
  return {
    id: row.id,
    brandId: row.brand_id,
    kind: row.kind,
    label: row.label,
    title: row.title,
    content: row.content,
    confidence: row.confidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    occurrenceCount: row.occurrence_count,
    sourceCount: row.source_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toExternalObservation(row: ExternalObservationRow): ExternalObservation {
  return {
    id: row.id,
    entryId: row.entry_id,
    sourceId: row.source_id,
    statement: row.statement,
    excerpt: row.excerpt,
    confidence: row.confidence,
    observedAt: row.observed_at,
  };
}

export function parseScoreComponents(value: unknown): ScoreComponent[] {
  const parsed = scoreComponentsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseInsightEvidence(value: unknown): InsightEvidence {
  const parsed = insightEvidenceSchema.safeParse(value);
  return parsed.success ? (parsed.data as InsightEvidence) : {};
}

export function toBrandInsight(row: BrandInsightRow): BrandInsight {
  return {
    id: row.id,
    brandId: row.brand_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    explanation: row.explanation,
    score: row.score,
    components: parseScoreComponents(row.components),
    evidence: parseInsightEvidence(row.evidence),
    internalEntryIds: row.internal_entry_ids ?? [],
    externalEntryIds: row.external_entry_ids ?? [],
    judgedBy: row.judged_by === "MODEL" ? "MODEL" : "HEURISTIC",
    computedAt: row.computed_at,
  };
}

export function toAnalysisRun(row: ExternalAnalysisRunRow): ExternalAnalysisRun {
  const status = row.status === "FAILED" || row.status === "PARTIAL" ? row.status : "OK";

  return {
    id: row.id,
    brandId: row.brand_id,
    status,
    notes: row.notes,
    insightCount: row.insight_count,
    internalEntryCount: row.internal_entry_count,
    externalEntryCount: row.external_entry_count,
    externalSourceCount: row.external_source_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
