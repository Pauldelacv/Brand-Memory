import type {
  BrandRow,
  BrandSourceRow,
  ConversationRow,
  MemoryEntryRow,
  MessageRow,
} from "@/types/database";
import type {
  Brand,
  BrandSource,
  ChatMessage,
  Conversation,
  MemoryEntry,
  RetrievalCitation,
  SourceReference,
} from "@/types/domain";
import { citationsSchema, sourceReferencesSchema } from "@/lib/validation";

/** jsonb columns arrive as `unknown`; parse rather than cast. */
export function parseSourceReferences(value: unknown): SourceReference[] {
  const parsed = sourceReferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseCitations(value: unknown): RetrievalCitation[] {
  const parsed = citationsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function toBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    industry: row.industry,
    website: row.website,
    audience: row.audience,
    positioning: row.positioning,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toBrandSource(row: BrandSourceRow): BrandSource {
  return {
    id: row.id,
    brandId: row.brand_id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    storagePath: row.storage_path,
    status: row.status,
    error: row.error,
    priority: row.priority,
    sourceDate: row.source_date,
    authoritative: row.authoritative,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

export function toMemoryEntry(row: MemoryEntryRow): MemoryEntry {
  return {
    id: row.id,
    brandId: row.brand_id,
    category: row.category,
    title: row.title,
    content: row.content,
    sourceReferences: parseSourceReferences(row.source_references),
    confidence: row.confidence,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    brandId: row.brand_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    brandId: row.brand_id,
    role: row.role,
    content: row.content,
    mode: row.mode,
    retrieval: parseCitations(row.retrieval),
    createdAt: row.created_at,
  };
}
