"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/db/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { getOwnedBrand, getOwnedSource } from "@/lib/db/queries";
import { SOURCE_BUCKET, storagePathFor } from "@/lib/storage";
import {
  ACCEPTED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  isAcceptedMimeType,
} from "@/lib/ingestion/media-types";
import { processSource } from "@/lib/ingestion/process";
import { uuidSchema } from "@/lib/validation";
import { describeError, failure } from "@/actions/result";
import type { ActionResult } from "@/actions/result";

const uploadMetaSchema = z.object({
  brandId: uuidSchema,
  authoritative: z.boolean().default(false),
  priority: z.coerce.number().int().min(0).max(10).default(0),
  sourceDate: z
    .union([z.iso.date(), z.literal("")])
    .optional()
    .transform((value) => (value ? value : null)),
});

export async function uploadSource(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const meta = uploadMetaSchema.safeParse({
    brandId: formData.get("brandId"),
    authoritative: formData.get("authoritative") === "on",
    priority: formData.get("priority") ?? 0,
    sourceDate: formData.get("sourceDate") ?? "",
  });

  if (!meta.success) return failure("The upload details are not valid.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return failure("Choose a file to upload.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return failure(`"${file.name}" is larger than the 25 MB limit.`);
  }
  if (!isAcceptedMimeType(file.type)) {
    return failure(
      `"${file.type || "unknown"}" is not supported. Accepted types: ${ACCEPTED_MIME_TYPES.join(", ")}.`,
    );
  }

  try {
    const { supabase } = await requireUser();
    // Ownership check before anything touches the service-role client.
    const brand = await getOwnedBrand(supabase, meta.data.brandId);

    const { data: created, error: insertError } = await supabase
      .from("brand_sources")
      .insert({
        brand_id: brand.id,
        filename: file.name,
        mime_type: file.type,
        byte_size: file.size,
        storage_path: "pending",
        status: "UPLOADED",
        authoritative: meta.data.authoritative,
        priority: meta.data.priority,
        source_date: meta.data.sourceDate,
      })
      .select("id")
      .single();

    if (insertError || !created) return failure("The source record could not be created.");

    const sourceId = created.id as string;
    const path = storagePathFor(brand.id, sourceId, file.name);

    const upload = await supabase.storage
      .from(SOURCE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });

    if (upload.error) {
      await supabase
        .from("brand_sources")
        .update({ status: "FAILED", error: "The file could not be uploaded to storage." })
        .eq("id", sourceId);
      return failure("The file could not be uploaded to storage.");
    }

    await supabase.from("brand_sources").update({ storage_path: path }).eq("id", sourceId);

    // Simple asynchronous processing: the pipeline runs after the response is
    // sent and the sources table polls for the status change.
    after(async () => {
      await processSource(createAdminSupabase(), sourceId).catch(() => {
        // processSource already records FAILED on the row; nothing to add here.
      });
    });

    revalidatePath(`/dashboard/brands/${brand.id}/sources`);
    revalidatePath(`/dashboard/brands/${brand.id}`);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function reprocessSource(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = uuidSchema.safeParse(formData.get("sourceId"));
  if (!id.success) return failure("Missing source identifier.");

  try {
    const { supabase } = await requireUser();
    const source = await getOwnedSource(supabase, id.data);

    const result = await processSource(createAdminSupabase(), source.id);

    revalidatePath(`/dashboard/brands/${source.brandId}/sources`);
    revalidatePath(`/dashboard/brands/${source.brandId}`);

    if (result.status === "FAILED") {
      return failure(result.error ?? "Processing failed.");
    }
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function deleteSource(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = uuidSchema.safeParse(formData.get("sourceId"));
  if (!id.success) return failure("Missing source identifier.");

  try {
    const { supabase } = await requireUser();
    const source = await getOwnedSource(supabase, id.data);

    if (source.storagePath && source.storagePath !== "pending") {
      await supabase.storage.from(SOURCE_BUCKET).remove([source.storagePath]);
    }

    // Chunks cascade from the foreign key.
    const { error } = await supabase.from("brand_sources").delete().eq("id", source.id);
    if (error) return failure("The source could not be deleted.");

    revalidatePath(`/dashboard/brands/${source.brandId}/sources`);
    revalidatePath(`/dashboard/brands/${source.brandId}`);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

const priorityFormSchema = z.object({
  sourceId: uuidSchema,
  priority: z.coerce.number().int().min(0).max(10),
  authoritative: z.boolean(),
});

export async function updateSourceTrust(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = priorityFormSchema.safeParse({
    sourceId: formData.get("sourceId"),
    priority: formData.get("priority") ?? 0,
    authoritative: formData.get("authoritative") === "on",
  });

  if (!parsed.success) return failure("The source settings are not valid.");

  try {
    const { supabase } = await requireUser();
    const source = await getOwnedSource(supabase, parsed.data.sourceId);

    const { error } = await supabase
      .from("brand_sources")
      .update({
        priority: parsed.data.priority,
        authoritative: parsed.data.authoritative,
      })
      .eq("id", source.id);

    if (error) return failure("The source could not be updated.");

    revalidatePath(`/dashboard/brands/${source.brandId}/sources`);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}
