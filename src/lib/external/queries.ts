import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError, NotFoundError } from "@/lib/db/queries";
import {
  toAnalysisRun,
  toBrandInsight,
  toExternalContent,
  toExternalFeed,
  toExternalMemoryEntry,
  toExternalSource,
} from "@/lib/external/mappers";
import type { ObservationPoint } from "@/lib/external/timeline";
import type {
  BrandInsightRow,
  ExternalAnalysisRunRow,
  ExternalContentRow,
  ExternalFeedRow,
  ExternalMemoryEntryRow,
  ExternalSourceRow,
} from "@/types/database";
import type {
  BrandInsight,
  ExternalAnalysisRun,
  ExternalContent,
  ExternalFeed,
  ExternalMemoryEntry,
  ExternalMemoryKind,
  ExternalSource,
  ExternalSourceListItem,
} from "@/types/external";

/**
 * Reads for the external half.
 *
 * Same contract as lib/db/queries.ts: everything goes through a session-scoped
 * client, so row level security has already restricted the result, and the
 * explicit ownership check turns a filtered-out row into a clear error rather
 * than a silent empty result.
 */

export async function listExternalFeeds(
  supabase: SupabaseClient,
  brandId: string,
): Promise<ExternalFeed[]> {
  const { data, error } = await supabase
    .from("external_feeds")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (error) throw new DatabaseError("Could not load the watched sources.", error);
  return (data as ExternalFeedRow[]).map(toExternalFeed);
}

export async function getOwnedFeed(supabase: SupabaseClient, feedId: string): Promise<ExternalFeed> {
  const { data, error } = await supabase
    .from("external_feeds")
    .select("*")
    .eq("id", feedId)
    .maybeSingle();

  if (error) throw new DatabaseError("Could not load this watched source.", error);
  if (!data) throw new NotFoundError("This watched source");
  return toExternalFeed(data as ExternalFeedRow);
}

export async function getOwnedExternalSource(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<ExternalSource> {
  const { data, error } = await supabase
    .from("external_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (error) throw new DatabaseError("Could not load this external source.", error);
  if (!data) throw new NotFoundError("This external source");
  return toExternalSource(data as ExternalSourceRow);
}

export async function getExternalContent(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<ExternalContent | null> {
  const { data, error } = await supabase
    .from("external_contents")
    .select("*")
    .eq("source_id", sourceId)
    .maybeSingle();

  if (error) throw new DatabaseError("Could not load the content of this source.", error);
  return data ? toExternalContent(data as ExternalContentRow) : null;
}

/**
 * The sources screen: acquisition rows joined with the headline of what was
 * read, and the themes each one produced.
 */
export async function listExternalSources(
  supabase: SupabaseClient,
  brandId: string,
  limit = 200,
): Promise<ExternalSourceListItem[]> {
  const [sourcesResult, contentsResult, themesBySource] = await Promise.all([
    supabase
      .from("external_sources")
      .select("*")
      .eq("brand_id", brandId)
      .order("discovered_at", { ascending: false })
      .limit(limit),
    supabase
      .from("external_contents")
      .select("source_id, title, publisher, author, published_at, summary")
      .eq("brand_id", brandId),
    loadThemesBySource(supabase, brandId),
  ]);

  if (sourcesResult.error) {
    throw new DatabaseError("Could not load the external sources.", sourcesResult.error);
  }
  if (contentsResult.error) {
    throw new DatabaseError("Could not load the external contents.", contentsResult.error);
  }

  const contents = new Map(
    (contentsResult.data ?? []).map((row) => [
      (row as { source_id: string }).source_id,
      row as {
        title: string;
        publisher: string | null;
        author: string | null;
        published_at: string | null;
        summary: string;
      },
    ]),
  );

  return (sourcesResult.data as ExternalSourceRow[]).map((row) => {
    const source = toExternalSource(row);
    const content = contents.get(row.id);

    return {
      ...source,
      title: content?.title || titleFromUrl(source.url),
      publisher: content?.publisher ?? null,
      author: content?.author ?? null,
      publishedAt: content?.published_at ?? null,
      summary: content?.summary ?? "",
      themes: themesBySource.get(row.id) ?? [],
    };
  });
}

async function loadThemesBySource(
  supabase: SupabaseClient,
  brandId: string,
): Promise<Map<string, string[]>> {
  const [observations, entries] = await Promise.all([
    supabase.from("external_memory_observations").select("source_id, entry_id").eq("brand_id", brandId),
    supabase.from("external_memory_entries").select("id, label").eq("brand_id", brandId),
  ]);

  if (observations.error) {
    throw new DatabaseError("Could not load the extracted themes.", observations.error);
  }
  if (entries.error) {
    throw new DatabaseError("Could not load the external memory.", entries.error);
  }

  const labels = new Map(
    (entries.data ?? []).map((row) => [(row as { id: string }).id, (row as { label: string }).label]),
  );

  const bySource = new Map<string, string[]>();
  for (const row of (observations.data ?? []) as Array<{ source_id: string; entry_id: string }>) {
    const label = labels.get(row.entry_id);
    if (!label) continue;
    const existing = bySource.get(row.source_id);
    if (existing) {
      if (!existing.includes(label)) existing.push(label);
    } else {
      bySource.set(row.source_id, [label]);
    }
  }

  return bySource;
}

export async function listExternalMemoryEntries(
  supabase: SupabaseClient,
  brandId: string,
  kind?: ExternalMemoryKind,
): Promise<ExternalMemoryEntry[]> {
  let query = supabase
    .from("external_memory_entries")
    .select("*")
    .eq("brand_id", brandId)
    .order("occurrence_count", { ascending: false });

  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error) throw new DatabaseError("Could not load the external memory.", error);
  return (data as ExternalMemoryEntryRow[]).map(toExternalMemoryEntry);
}

/** Every dated observation for the brand: the input to all temporal views. */
export async function listObservationPoints(
  supabase: SupabaseClient,
  brandId: string,
): Promise<ObservationPoint[]> {
  const [observations, entries] = await Promise.all([
    supabase
      .from("external_memory_observations")
      .select("entry_id, source_id, observed_at")
      .eq("brand_id", brandId)
      .order("observed_at", { ascending: true }),
    supabase.from("external_memory_entries").select("id, label, kind").eq("brand_id", brandId),
  ]);

  if (observations.error) {
    throw new DatabaseError("Could not load the external timeline.", observations.error);
  }
  if (entries.error) {
    throw new DatabaseError("Could not load the external memory.", entries.error);
  }

  const meta = new Map(
    (entries.data ?? []).map((row) => {
      const entry = row as { id: string; label: string; kind: ExternalMemoryKind };
      return [entry.id, entry];
    }),
  );

  const points: ObservationPoint[] = [];
  for (const row of (observations.data ?? []) as Array<{
    entry_id: string;
    source_id: string;
    observed_at: string;
  }>) {
    const entry = meta.get(row.entry_id);
    if (!entry) continue;
    points.push({
      entryId: row.entry_id,
      label: entry.label,
      kind: entry.kind,
      sourceId: row.source_id,
      observedAt: row.observed_at,
    });
  }

  return points;
}

export async function listBrandInsights(
  supabase: SupabaseClient,
  brandId: string,
): Promise<BrandInsight[]> {
  const { data, error } = await supabase
    .from("brand_insights")
    .select("*")
    .eq("brand_id", brandId)
    .order("score", { ascending: false });

  if (error) throw new DatabaseError("Could not load the consistency analysis.", error);
  return (data as BrandInsightRow[]).map(toBrandInsight);
}

export async function latestAnalysisRun(
  supabase: SupabaseClient,
  brandId: string,
): Promise<ExternalAnalysisRun | null> {
  const { data, error } = await supabase
    .from("external_analysis_runs")
    .select("*")
    .eq("brand_id", brandId)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) throw new DatabaseError("Could not load the analysis history.", error);
  const rows = (data ?? []) as ExternalAnalysisRunRow[];
  const row = rows[0];
  return row ? toAnalysisRun(row) : null;
}

/** Publication dates and tone words, for the overview and tone drift views. */
export async function listContentSignals(
  supabase: SupabaseClient,
  brandId: string,
): Promise<Array<{ sourceId: string; publishedAt: string | null; tone: string[]; publisher: string | null }>> {
  const { data, error } = await supabase
    .from("external_contents")
    .select("source_id, published_at, tone, publisher")
    .eq("brand_id", brandId);

  if (error) throw new DatabaseError("Could not load the external contents.", error);

  return ((data ?? []) as Array<{
    source_id: string;
    published_at: string | null;
    tone: string[] | null;
    publisher: string | null;
  }>).map((row) => ({
    sourceId: row.source_id,
    publishedAt: row.published_at,
    tone: row.tone ?? [],
    publisher: row.publisher,
  }));
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last).replace(/[-_]+/g, " ") : parsed.hostname;
  } catch {
    return url;
  }
}
