import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "@/lib/ai";
import { EXTRACTION_SYSTEM_PROMPT, extractionUserPrompt } from "@/lib/ai/prompts";
import { brandAnalysisSchema } from "@/lib/validation";
import type { Brand, SourceReference } from "@/types/domain";
import { DatabaseError } from "@/lib/db/queries";

/**
 * Builds the structured layer of Brand Memory from the document chunks.
 *
 * The model's answer is parsed and validated before anything is written, and
 * entries a person has edited are never overwritten — AI extraction is a
 * suggestion, not the source of truth.
 */

export class ExtractionRejectedError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "ExtractionRejectedError";
  }
}

export interface MemoryExtractionResult {
  created: number;
  updated: number;
  skippedUserEdited: number;
}

const MAX_CHUNKS_PER_PASS = 40;

export async function extractBrandMemory(
  admin: SupabaseClient,
  brand: Brand,
): Promise<MemoryExtractionResult> {
  const { data: chunkRows, error: chunkError } = await admin
    .from("document_chunks")
    .select("id, content, source_id")
    .eq("brand_id", brand.id)
    .order("created_at", { ascending: false })
    .limit(MAX_CHUNKS_PER_PASS);

  if (chunkError) throw new DatabaseError("Could not read the processed documents.", chunkError);

  const chunks = (chunkRows ?? []) as Array<{ id: string; content: string; source_id: string }>;
  if (chunks.length === 0) {
    return { created: 0, updated: 0, skippedUserEdited: 0 };
  }

  const provider = getAIProvider();
  const output = await provider.generateText({
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: extractionUserPrompt(brand, chunks) }],
    maxTokens: 4000,
    temperature: 0,
    json: true,
  });

  const analysis = parseAnalysis(output.text);
  const chunkToSource = new Map(chunks.map((chunk) => [chunk.id, chunk.source_id]));
  const sourceNames = await loadSourceNames(admin, brand.id);

  const { data: existingRows, error: existingError } = await admin
    .from("brand_memory_entries")
    .select("id, category, title, origin")
    .eq("brand_id", brand.id);

  if (existingError) {
    throw new DatabaseError("Could not read the existing brand memory.", existingError);
  }

  const existing = new Map(
    (existingRows ?? []).map((row) => [
      claimKey(row.category as string, row.title as string),
      row as { id: string; origin: string },
    ]),
  );

  let created = 0;
  let updated = 0;
  let skippedUserEdited = 0;

  for (const entry of analysis.entries) {
    const key = claimKey(entry.category, entry.title);
    const match = existing.get(key);

    if (match && match.origin === "USER_EDITED") {
      skippedUserEdited += 1;
      continue;
    }

    const references: SourceReference[] = entry.evidence
      .map((evidence) => {
        const sourceId = chunkToSource.get(evidence.chunkId);
        if (!sourceId) return null;
        return {
          sourceId,
          sourceName: sourceNames.get(sourceId) ?? "Unknown source",
          excerpt: evidence.excerpt,
        };
      })
      .filter((reference): reference is SourceReference => reference !== null);

    const embedding = await provider.generateEmbedding(`${entry.title}\n${entry.content}`);

    const payload = {
      brand_id: brand.id,
      category: entry.category,
      title: entry.title,
      content: entry.content,
      source_references: references,
      confidence: entry.confidence,
      origin: "AI_EXTRACTED" as const,
      embedding,
    };

    if (match) {
      const { error } = await admin
        .from("brand_memory_entries")
        .update(payload)
        .eq("id", match.id);
      if (error) throw new DatabaseError("Could not update a memory entry.", error);
      updated += 1;
    } else {
      const { error } = await admin.from("brand_memory_entries").insert(payload);
      if (error) throw new DatabaseError("Could not store a memory entry.", error);
      created += 1;
    }
  }

  return { created, updated, skippedUserEdited };
}

/** Same category + same title means the same claim slot. */
function claimKey(category: string, title: string): string {
  return `${category}:${title.trim().toLowerCase()}`;
}

async function loadSourceNames(
  admin: SupabaseClient,
  brandId: string,
): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("brand_sources")
    .select("id, filename")
    .eq("brand_id", brandId);

  if (error) throw new DatabaseError("Could not read the source list.", error);
  return new Map((data ?? []).map((row) => [row.id as string, row.filename as string]));
}

/** Models sometimes wrap JSON in a fence; strip it, then validate strictly. */
export function parseAnalysis(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ExtractionRejectedError("The model did not return valid JSON.", raw);
  }

  const result = brandAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExtractionRejectedError(
      `The extraction did not match the expected shape: ${result.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
      raw,
    );
  }

  return result.data;
}
