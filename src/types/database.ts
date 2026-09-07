/**
 * Row shapes as they come back from PostgREST (snake_case).
 * Hand written rather than generated so the repo has no build-time dependency
 * on a live Supabase project.
 */
import type {
  GenerationMode,
  MemoryCategory,
  MemoryOrigin,
  MessageRole,
  SourceStatus,
} from "./domain";
import type {
  BrandInsightKind,
  ExternalConnectorKind,
  ExternalMediaClass,
  ExternalMemoryKind,
  ExternalSourceType,
  ExternalStatus,
  ExternalSyncFrequency,
} from "./external";

export interface BrandRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  industry: string;
  website: string | null;
  audience: string | null;
  positioning: string | null;
  owned_domains: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface BrandSourceRow {
  id: string;
  brand_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  status: SourceStatus;
  error: string | null;
  priority: number;
  source_date: string | null;
  authoritative: boolean;
  chunk_count: number;
  created_at: string;
  processed_at: string | null;
}

export interface MemoryEntryRow {
  id: string;
  brand_id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  source_references: unknown;
  confidence: number;
  origin: MemoryOrigin;
  created_at: string;
  updated_at: string;
}

export interface ConversationRow {
  id: string;
  brand_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  brand_id: string;
  role: MessageRole;
  content: string;
  mode: GenerationMode;
  retrieval: unknown;
  created_at: string;
}

export interface MatchedChunkRow {
  id: string;
  source_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

export interface MatchedMemoryRow {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  source_references: unknown;
  confidence: number;
  origin: MemoryOrigin;
  updated_at: string;
  similarity: number;
}

/* External Brand Memory rows. Same convention: snake_case, straight from PostgREST. */

export interface ExternalFeedRow {
  id: string;
  brand_id: string;
  kind: ExternalConnectorKind;
  url: string;
  label: string;
  enabled: boolean;
  frequency: ExternalSyncFrequency;
  max_documents: number;
  last_synced_at: string | null;
  last_error: string | null;
  discovered_count: number;
  created_at: string;
  updated_at: string;
}

export interface ExternalSourceRow {
  id: string;
  brand_id: string;
  feed_id: string | null;
  source_type: ExternalSourceType;
  media_class: ExternalMediaClass;
  url: string;
  canonical_url: string | null;
  url_hash: string;
  content_hash: string | null;
  status: ExternalStatus;
  extraction_error: string | null;
  duplicate_of: string | null;
  duplicate_kind: string | null;
  duplicate_similarity: number | null;
  discovered_at: string;
  fetched_at: string | null;
  processed_at: string | null;
  chunk_count: number;
  entry_count: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

export interface ExternalContentRow {
  id: string;
  brand_id: string;
  source_id: string;
  title: string;
  body: string;
  summary: string;
  author: string | null;
  publisher: string | null;
  published_at: string | null;
  language: string | null;
  tone: string[] | null;
  narrative: string;
  images: unknown;
  word_count: number;
  metadata: unknown;
  extracted_at: string;
}

export interface ExternalMemoryEntryRow {
  id: string;
  brand_id: string;
  kind: ExternalMemoryKind;
  label: string;
  title: string;
  content: string;
  confidence: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  occurrence_count: number;
  source_count: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

export interface ExternalObservationRow {
  id: string;
  brand_id: string;
  entry_id: string;
  source_id: string;
  statement: string;
  excerpt: string;
  confidence: number;
  observed_at: string;
  created_at: string;
}

export interface BrandInsightRow {
  id: string;
  brand_id: string;
  kind: BrandInsightKind;
  title: string;
  summary: string;
  explanation: string;
  score: number;
  components: unknown;
  evidence: unknown;
  internal_entry_ids: string[] | null;
  external_entry_ids: string[] | null;
  judged_by: string;
  computed_at: string;
}

export interface ExternalAnalysisRunRow {
  id: string;
  brand_id: string;
  status: string;
  notes: string;
  insight_count: number;
  internal_entry_count: number;
  external_entry_count: number;
  external_source_count: number;
  started_at: string;
  finished_at: string | null;
}

export interface MatchedExternalChunkRow {
  id: string;
  source_id: string;
  content: string;
  published_at: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

export interface MatchedExternalMemoryRow {
  id: string;
  kind: ExternalMemoryKind;
  label: string;
  title: string;
  content: string;
  confidence: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  occurrence_count: number;
  source_count: number;
  updated_at: string;
  similarity: number;
}
