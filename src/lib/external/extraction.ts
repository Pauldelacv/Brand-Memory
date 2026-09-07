import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "@/lib/ai";
import { EXTERNAL_EXTRACTION_SYSTEM_PROMPT, externalExtractionUserPrompt } from "@/lib/ai/prompts";
import { DatabaseError } from "@/lib/db/queries";
import { externalAnalysisSchema } from "@/lib/validation";
import type { ExternalAnalysis } from "@/lib/validation";
import type { Brand } from "@/types/domain";
import type { ExternalMemoryKind } from "@/types/external";

/**
 * Turns one published content into structured external memory.
 *
 * The model reads a single dated document and says what it communicates. Its
 * answer is validated before anything is written, and it is recorded as
 * *observations* — one row per (theme, source, date) — rather than as a fact
 * about the brand. Themes and their counters are then derived from those
 * observations, which is what makes "this message appeared 17 times across 9
 * sources since January 2025" a query rather than a claim.
 */

export class ExternalExtractionRejectedError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "ExternalExtractionRejectedError";
  }
}

export interface ExternalExtractionResult {
  /** Observations written for this source. */
  recorded: number;
  /** Themes created for the brand by this content. */
  created: number;
  /** Set when the structured pass failed but the content is still searchable. */
  error?: string;
}

/** Models sometimes wrap JSON in a fence; strip it, then validate strictly. */
export function parseExternalAnalysis(raw: string): ExternalAnalysis {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ExternalExtractionRejectedError("The model did not return valid JSON.", raw);
  }

  const result = externalAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExternalExtractionRejectedError(
      `The reading did not match the expected shape: ${result.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
      raw,
    );
  }

  return result.data;
}

/**
 * The theme key. Two contents that talk about "Sustainability" and
 * "sustainability " must land on the same theme, or the counters mean nothing.
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
}

export async function extractExternalMemoryForSource(
  admin: SupabaseClient,
  brand: Brand,
  sourceId: string,
): Promise<ExternalExtractionResult> {
  const { data: contentRow, error: contentError } = await admin
    .from("external_contents")
    .select("title, body, publisher, author, published_at, language")
    .eq("source_id", sourceId)
    .eq("brand_id", brand.id)
    .maybeSingle();

  if (contentError) throw new DatabaseError("Could not read the stored content.", contentError);
  if (!contentRow) {
    return { recorded: 0, created: 0, error: "There is no stored content for this source." };
  }

  const { data: sourceRow, error: sourceError } = await admin
    .from("external_sources")
    .select("url, discovered_at")
    .eq("id", sourceId)
    .eq("brand_id", brand.id)
    .maybeSingle();

  if (sourceError) throw new DatabaseError("Could not read the external source.", sourceError);
  if (!sourceRow) {
    return { recorded: 0, created: 0, error: "The external source has gone." };
  }

  const content = contentRow as {
    title: string;
    body: string;
    publisher: string | null;
    author: string | null;
    published_at: string | null;
    language: string | null;
  };
  const source = sourceRow as { url: string; discovered_at: string };

  const provider = getAIProvider();

  let analysis: ExternalAnalysis;
  try {
    const output = await provider.generateText({
      system: EXTERNAL_EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: externalExtractionUserPrompt(brand, {
            title: content.title,
            publisher: content.publisher,
            author: content.author,
            publishedAt: content.published_at,
            url: source.url,
            body: content.body,
          }),
        },
      ],
      maxTokens: 3000,
      temperature: 0,
      json: true,
    });

    analysis = parseExternalAnalysis(output.text);
  } catch (error) {
    return {
      recorded: 0,
      created: 0,
      error: error instanceof Error ? error.message : "The structured reading failed.",
    };
  }

  // The date the brand said it, not the date we read it. Everything temporal
  // depends on this being the publication date wherever one exists.
  const observedAt = content.published_at ?? source.discovered_at;

  await admin
    .from("external_contents")
    .update({
      summary: analysis.summary.slice(0, 1000),
      narrative: analysis.narrative,
      tone: analysis.tone.map((word) => word.toLowerCase()).slice(0, 8),
      language: content.language ?? analysis.language ?? null,
    })
    .eq("source_id", sourceId);

  let recorded = 0;
  let created = 0;

  for (const entry of analysis.entries) {
    const label = normalizeLabel(entry.label);
    if (!label) continue;

    const outcome = await upsertTheme(admin, brand.id, entry.kind, label, entry.statement, entry.confidence);
    if (outcome.created) created += 1;

    const { error } = await admin.from("external_memory_observations").upsert(
      {
        brand_id: brand.id,
        entry_id: outcome.entryId,
        source_id: sourceId,
        statement: entry.statement,
        excerpt: entry.excerpt,
        confidence: entry.confidence,
        observed_at: observedAt,
      },
      { onConflict: "entry_id,source_id" },
    );

    if (error) throw new DatabaseError("An external observation could not be stored.", error);
    recorded += 1;
  }

  await admin.from("external_sources").update({ entry_count: recorded }).eq("id", sourceId);

  return { recorded, created };
}

interface ThemeOutcome {
  entryId: string;
  created: boolean;
}

/**
 * Finds or creates the theme for a (kind, label) pair.
 *
 * An existing theme keeps its wording — the first content to name a theme sets
 * how it reads — but its confidence rises with corroboration, and its
 * embedding is written once so cross analysis can compare it semantically.
 */
async function upsertTheme(
  admin: SupabaseClient,
  brandId: string,
  kind: ExternalMemoryKind,
  label: string,
  statement: string,
  confidence: number,
): Promise<ThemeOutcome> {
  const { data: existing, error: lookupError } = await admin
    .from("external_memory_entries")
    .select("id, confidence, content")
    .eq("brand_id", brandId)
    .eq("kind", kind)
    .eq("label", label)
    .maybeSingle();

  if (lookupError) throw new DatabaseError("Could not read the external memory.", lookupError);

  if (existing) {
    const row = existing as { id: string; confidence: number };
    // Repetition across contents is corroboration, so confidence climbs towards
    // the higher of the two rather than being overwritten by the latest read.
    const merged = Math.min(1, Math.max(row.confidence, confidence) + 0.05);

    const { error } = await admin
      .from("external_memory_entries")
      .update({ confidence: merged })
      .eq("id", row.id);

    if (error) throw new DatabaseError("Could not update an external theme.", error);
    return { entryId: row.id, created: false };
  }

  const title = label.charAt(0).toUpperCase() + label.slice(1);
  const embedding = await getAIProvider().generateEmbedding(`${title}\n${statement}`);

  const { data, error } = await admin
    .from("external_memory_entries")
    .insert({
      brand_id: brandId,
      kind,
      label,
      title,
      content: statement,
      confidence,
      embedding,
    })
    .select("id")
    .single();

  if (error || !data) throw new DatabaseError("An external theme could not be stored.", error);
  return { entryId: (data as { id: string }).id, created: true };
}

/** Re-runs the structured pass over every stored content that has no themes yet. */
export async function extractMissingExternalMemory(
  admin: SupabaseClient,
  brand: Brand,
  limit = 25,
): Promise<{ processed: number; recorded: number; failures: string[] }> {
  const { data, error } = await admin
    .from("external_sources")
    .select("id")
    .eq("brand_id", brand.id)
    .eq("status", "READY")
    .eq("entry_count", 0)
    .limit(limit);

  if (error) throw new DatabaseError("Could not list the contents awaiting extraction.", error);

  const failures: string[] = [];
  let recorded = 0;
  let processed = 0;

  for (const row of (data ?? []) as Array<{ id: string }>) {
    const result = await extractExternalMemoryForSource(admin, brand, row.id);
    processed += 1;
    recorded += result.recorded;
    if (result.error) failures.push(result.error);
  }

  return { processed, recorded, failures };
}
