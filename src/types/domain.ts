/**
 * Domain types. These mirror the SQL schema in supabase/migrations and are the
 * contract used by actions, retrieval and the UI.
 */

export const SOURCE_STATUSES = ["UPLOADED", "PROCESSING", "READY", "FAILED"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const MEMORY_CATEGORIES = [
  "IDENTITY",
  "POSITIONING",
  "AUDIENCE",
  "PERSONALITY",
  "VOICE",
  "VISUAL_LANGUAGE",
  "VALUES",
  "PRODUCT",
  "CREATIVE_HISTORY",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_ORIGINS = ["AI_EXTRACTED", "USER_EDITED"] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export const GENERATION_MODES = ["ASK", "CREATE", "EXPLORE", "COMPARE"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export type MessageRole = "user" | "assistant";

export interface Brand {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  industry: string;
  website: string | null;
  audience: string | null;
  positioning: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandSource {
  id: string;
  brandId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  status: SourceStatus;
  error: string | null;
  priority: number;
  sourceDate: string | null;
  authoritative: boolean;
  chunkCount: number;
  createdAt: string;
  processedAt: string | null;
}

export interface SourceReference {
  sourceId: string;
  sourceName: string;
  excerpt: string;
}

export interface MemoryEntry {
  id: string;
  brandId: string;
  category: MemoryCategory;
  title: string;
  content: string;
  sourceReferences: SourceReference[];
  confidence: number;
  origin: MemoryOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  brandId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** What the UI needs to explain "why did the AI generate this?". */
export interface RetrievalCitation {
  kind: "MEMORY" | "DOCUMENT";
  refId: string;
  label: string;
  excerpt: string;
  similarity: number;
  sourceId: string | null;
  sourceName: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  brandId: string;
  role: MessageRole;
  content: string;
  mode: GenerationMode;
  retrieval: RetrievalCitation[];
  createdAt: string;
}

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  IDENTITY: "Identity",
  POSITIONING: "Positioning",
  AUDIENCE: "Audience",
  PERSONALITY: "Personality",
  VOICE: "Voice",
  VISUAL_LANGUAGE: "Visual language",
  VALUES: "Values",
  PRODUCT: "Products",
  CREATIVE_HISTORY: "Creative history",
};

export const GENERATION_MODE_LABELS: Record<GenerationMode, string> = {
  ASK: "Ask",
  CREATE: "Create",
  EXPLORE: "Explore",
  COMPARE: "Compare",
};
