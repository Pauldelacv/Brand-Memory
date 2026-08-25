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

export interface BrandRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  industry: string;
  website: string | null;
  audience: string | null;
  positioning: string | null;
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
