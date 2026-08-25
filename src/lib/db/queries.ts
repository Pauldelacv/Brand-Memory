import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrandRow,
  BrandSourceRow,
  ConversationRow,
  MemoryEntryRow,
  MessageRow,
} from "@/types/database";
import type { Brand, BrandSource, ChatMessage, Conversation, MemoryEntry } from "@/types/domain";
import {
  toBrand,
  toBrandSource,
  toChatMessage,
  toConversation,
  toMemoryEntry,
} from "@/lib/db/mappers";

/**
 * Read helpers. They all go through a session-scoped client, so row level
 * security already restricts them to the caller's brands; the explicit
 * ownership check below turns a filtered-out row into a clear error instead of
 * a silent empty result.
 */

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found, or you do not have access to it.`);
    this.name = "NotFoundError";
  }
}

export class DatabaseError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "DatabaseError";
  }
}

export async function listBrands(supabase: SupabaseClient): Promise<Brand[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new DatabaseError("Could not load your brands.", error);
  return (data as BrandRow[]).map(toBrand);
}

/** Every brand-scoped operation starts here. */
export async function getOwnedBrand(supabase: SupabaseClient, brandId: string): Promise<Brand> {
  const { data, error } = await supabase.from("brands").select("*").eq("id", brandId).maybeSingle();

  if (error) throw new DatabaseError("Could not load this brand.", error);
  if (!data) throw new NotFoundError("This brand");
  return toBrand(data as BrandRow);
}

export async function listSources(
  supabase: SupabaseClient,
  brandId: string,
): Promise<BrandSource[]> {
  const { data, error } = await supabase
    .from("brand_sources")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (error) throw new DatabaseError("Could not load the sources for this brand.", error);
  return (data as BrandSourceRow[]).map(toBrandSource);
}

export async function getOwnedSource(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<BrandSource> {
  const { data, error } = await supabase
    .from("brand_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (error) throw new DatabaseError("Could not load this source.", error);
  if (!data) throw new NotFoundError("This source");
  return toBrandSource(data as BrandSourceRow);
}

export async function listMemoryEntries(
  supabase: SupabaseClient,
  brandId: string,
): Promise<MemoryEntry[]> {
  const { data, error } = await supabase
    .from("brand_memory_entries")
    .select("*")
    .eq("brand_id", brandId)
    .order("category", { ascending: true })
    .order("confidence", { ascending: false });

  if (error) throw new DatabaseError("Could not load the brand memory.", error);
  return (data as MemoryEntryRow[]).map(toMemoryEntry);
}

export async function getOwnedMemoryEntry(
  supabase: SupabaseClient,
  entryId: string,
): Promise<MemoryEntry> {
  const { data, error } = await supabase
    .from("brand_memory_entries")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();

  if (error) throw new DatabaseError("Could not load this memory entry.", error);
  if (!data) throw new NotFoundError("This memory entry");
  return toMemoryEntry(data as MemoryEntryRow);
}

export async function listConversations(
  supabase: SupabaseClient,
  brandId: string,
): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("brand_id", brandId)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) throw new DatabaseError("Could not load conversations.", error);
  return (data as ConversationRow[]).map(toConversation);
}

export async function getOwnedConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw new DatabaseError("Could not load this conversation.", error);
  if (!data) throw new NotFoundError("This conversation");
  return toConversation(data as ConversationRow);
}

export async function listMessages(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw new DatabaseError("Could not load this conversation.", error);
  return (data as MessageRow[]).map(toChatMessage);
}
