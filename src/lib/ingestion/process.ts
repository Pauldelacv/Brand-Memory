import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "@/lib/ai";
import { chunkText } from "@/lib/ingestion/chunk";
import { ExtractionError, extractText } from "@/lib/ingestion/extract";
import { SOURCE_BUCKET } from "@/lib/storage";

/**
 * UPLOAD -> VALIDATE -> EXTRACT -> CHUNK -> EMBED -> STORE -> READY
 *
 * Runs with a service-role client, so the caller MUST have verified that the
 * signed-in user owns the brand before invoking this.
 */

export interface ProcessResult {
  status: "READY" | "FAILED";
  chunkCount: number;
  error?: string;
}

export async function processSource(
  admin: SupabaseClient,
  sourceId: string,
): Promise<ProcessResult> {
  const { data: source, error: loadError } = await admin
    .from("brand_sources")
    .select("id, brand_id, filename, mime_type, storage_path")
    .eq("id", sourceId)
    .maybeSingle();

  if (loadError || !source) {
    return { status: "FAILED", chunkCount: 0, error: "The source record could not be loaded." };
  }

  await admin
    .from("brand_sources")
    .update({ status: "PROCESSING", error: null })
    .eq("id", sourceId);

  try {
    const download = await admin.storage.from(SOURCE_BUCKET).download(source.storage_path);
    if (download.error || !download.data) {
      throw new ExtractionError("The uploaded file could not be downloaded from storage.");
    }

    const buffer = await download.data.arrayBuffer();
    const extraction = await extractText(buffer, source.mime_type, source.filename);
    const chunks = chunkText(extraction.text);

    if (chunks.length === 0) {
      throw new ExtractionError(`No usable text was found in "${source.filename}".`);
    }

    const provider = getAIProvider();
    const embeddings = await embedAll(
      chunks.map((chunk) => chunk.content),
      (input) => provider.generateEmbedding(input),
    );

    // Re-processing replaces the previous chunks rather than appending to them.
    await admin.from("document_chunks").delete().eq("source_id", sourceId);

    const { error: insertError } = await admin.from("document_chunks").insert(
      chunks.map((chunk, index) => ({
        source_id: sourceId,
        brand_id: source.brand_id,
        chunk_index: chunk.index,
        content: chunk.content,
        token_estimate: chunk.tokenEstimate,
        embedding: embeddings[index] ?? null,
        metadata: {
          filename: source.filename,
          extraction: extraction.method,
        },
      })),
    );

    if (insertError) {
      throw new ExtractionError("The extracted text could not be stored.", insertError);
    }

    await admin
      .from("brand_sources")
      .update({
        status: "READY",
        error: null,
        chunk_count: chunks.length,
        processed_at: new Date().toISOString(),
      })
      .eq("id", sourceId);

    return { status: "READY", chunkCount: chunks.length };
  } catch (error) {
    const message = describeFailure(error);
    await admin
      .from("brand_sources")
      .update({ status: "FAILED", error: message, chunk_count: 0 })
      .eq("id", sourceId);

    return { status: "FAILED", chunkCount: 0, error: message };
  }
}

/** Embeds sequentially in small batches to stay well inside provider rate limits. */
async function embedAll(
  inputs: string[],
  embed: (input: string) => Promise<number[]>,
  concurrency = 4,
): Promise<number[][]> {
  const results: number[][] = new Array(inputs.length);

  for (let start = 0; start < inputs.length; start += concurrency) {
    const slice = inputs.slice(start, start + concurrency);
    const embedded = await Promise.all(slice.map((input) => embed(input)));
    embedded.forEach((vector, offset) => {
      results[start + offset] = vector;
    });
  }

  return results;
}

function describeFailure(error: unknown): string {
  if (error instanceof ExtractionError) return error.message;
  if (error instanceof Error) return error.message;
  return "Processing failed for an unknown reason.";
}
