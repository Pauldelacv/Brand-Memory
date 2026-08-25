"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/db/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { getOwnedBrand, getOwnedMemoryEntry } from "@/lib/db/queries";
import { getAIProvider } from "@/lib/ai";
import { extractBrandMemory } from "@/lib/ingestion/memory";
import { fieldErrors, memoryEntryInputSchema, uuidSchema } from "@/lib/validation";
import { describeError, failure } from "@/actions/result";
import type { ActionResult } from "@/actions/result";

function readEntryForm(formData: FormData) {
  return memoryEntryInputSchema.safeParse({
    category: formData.get("category"),
    title: formData.get("title"),
    content: formData.get("content"),
  });
}

export async function createMemoryEntry(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const brandId = uuidSchema.safeParse(formData.get("brandId"));
  if (!brandId.success) return failure("Missing brand identifier.");

  const parsed = readEntryForm(formData);
  if (!parsed.success) return failure("Check the fields below.", fieldErrors(parsed.error));

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, brandId.data);

    const embedding = await getAIProvider().generateEmbedding(
      `${parsed.data.title}\n${parsed.data.content}`,
    );

    const { error } = await supabase.from("brand_memory_entries").insert({
      brand_id: brand.id,
      category: parsed.data.category,
      title: parsed.data.title,
      content: parsed.data.content,
      source_references: [],
      confidence: 1,
      origin: "USER_EDITED",
      embedding,
    });

    if (error) return failure("The entry could not be saved.");

    revalidatePath(`/dashboard/brands/${brand.id}/memory`);
    revalidatePath(`/dashboard/brands/${brand.id}`);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

/** A user edit promotes the entry to the top of the conflict ladder. */
export async function updateMemoryEntry(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const entryId = uuidSchema.safeParse(formData.get("entryId"));
  if (!entryId.success) return failure("Missing entry identifier.");

  const parsed = readEntryForm(formData);
  if (!parsed.success) return failure("Check the fields below.", fieldErrors(parsed.error));

  try {
    const { supabase } = await requireUser();
    const entry = await getOwnedMemoryEntry(supabase, entryId.data);

    const embedding = await getAIProvider().generateEmbedding(
      `${parsed.data.title}\n${parsed.data.content}`,
    );

    const { error } = await supabase
      .from("brand_memory_entries")
      .update({
        category: parsed.data.category,
        title: parsed.data.title,
        content: parsed.data.content,
        origin: "USER_EDITED",
        confidence: 1,
        embedding,
      })
      .eq("id", entry.id);

    if (error) return failure("The entry could not be updated.");

    revalidatePath(`/dashboard/brands/${entry.brandId}/memory`);
    revalidatePath(`/dashboard/brands/${entry.brandId}`);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function deleteMemoryEntry(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const entryId = uuidSchema.safeParse(formData.get("entryId"));
  if (!entryId.success) return failure("Missing entry identifier.");

  try {
    const { supabase } = await requireUser();
    const entry = await getOwnedMemoryEntry(supabase, entryId.data);

    const { error } = await supabase.from("brand_memory_entries").delete().eq("id", entry.id);
    if (error) return failure("The entry could not be deleted.");

    revalidatePath(`/dashboard/brands/${entry.brandId}/memory`);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export interface ExtractionSummary {
  created: number;
  updated: number;
  skippedUserEdited: number;
}

export async function runMemoryExtraction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ExtractionSummary>> {
  const brandId = uuidSchema.safeParse(formData.get("brandId"));
  if (!brandId.success) return failure("Missing brand identifier.");

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, brandId.data);

    const result = await extractBrandMemory(createAdminSupabase(), brand);

    revalidatePath(`/dashboard/brands/${brand.id}/memory`);
    revalidatePath(`/dashboard/brands/${brand.id}`);
    return { ok: true, data: result };
  } catch (error) {
    return failure(describeError(error));
  }
}
