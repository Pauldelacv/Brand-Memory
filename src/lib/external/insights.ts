import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "@/lib/ai";
import { CONTRADICTION_JUDGE_SYSTEM_PROMPT, contradictionJudgeUserPrompt } from "@/lib/ai/prompts";
import { DatabaseError } from "@/lib/db/queries";
import { runCrossAnalysis } from "@/lib/external/cross-analysis";
import type { AnalysisInsight, ExternalTheme, InternalClaim } from "@/lib/external/cross-analysis";
import { parseVector } from "@/lib/external/mappers";
import { listContentSignals, listObservationPoints } from "@/lib/external/queries";
import { contradictionJudgementSchema } from "@/lib/validation";
import type { Brand, MemoryCategory, MemoryOrigin } from "@/types/domain";
import type { ExternalMemoryKind } from "@/types/external";

/**
 * Runs the cross analysis for a brand and stores the result.
 *
 * The detection itself is pure (cross-analysis.ts). This module is the IO half:
 * it loads both memories with their embeddings, asks a model to review the
 * contradiction shortlist, and replaces the stored insights atomically enough
 * that the dashboard never shows half of two runs.
 *
 * The model can only confirm or reject candidates the deterministic pass
 * produced. It cannot invent a contradiction, and if it is unavailable the run
 * completes as PARTIAL with the heuristic verdicts kept and the reason recorded.
 */

/** Cap on how much of each memory enters one analysis pass. */
const MAX_ENTRIES = 200;
const MAX_JUDGED_CANDIDATES = 20;

export interface AnalysisSummary {
  runId: string;
  status: "OK" | "PARTIAL";
  insightCount: number;
  internalCount: number;
  externalCount: number;
  sourceCount: number;
  notes: string;
}

async function loadInternalClaims(admin: SupabaseClient, brandId: string): Promise<InternalClaim[]> {
  const { data, error } = await admin
    .from("brand_memory_entries")
    .select("id, category, title, content, origin, confidence, updated_at, embedding")
    .eq("brand_id", brandId)
    .limit(MAX_ENTRIES);

  if (error) throw new DatabaseError("Could not read the internal brand memory.", error);

  return ((data ?? []) as Array<{
    id: string;
    category: MemoryCategory;
    title: string;
    content: string;
    origin: MemoryOrigin;
    confidence: number;
    updated_at: string;
    embedding: unknown;
  }>).map((row) => ({
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    origin: row.origin,
    confidence: row.confidence,
    updatedAt: row.updated_at,
    embedding: parseVector(row.embedding),
  }));
}

async function loadExternalThemes(admin: SupabaseClient, brandId: string): Promise<ExternalTheme[]> {
  const { data, error } = await admin
    .from("external_memory_entries")
    .select(
      "id, kind, label, title, content, confidence, first_seen_at, last_seen_at, occurrence_count, source_count, embedding",
    )
    .eq("brand_id", brandId)
    .order("occurrence_count", { ascending: false })
    .limit(MAX_ENTRIES);

  if (error) throw new DatabaseError("Could not read the external memory.", error);

  return ((data ?? []) as Array<{
    id: string;
    kind: ExternalMemoryKind;
    label: string;
    title: string;
    content: string;
    confidence: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
    occurrence_count: number;
    source_count: number;
    embedding: unknown;
  }>).map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    title: row.title,
    content: row.content,
    confidence: row.confidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    occurrenceCount: row.occurrence_count,
    sourceCount: row.source_count,
    embedding: parseVector(row.embedding),
  }));
}

/**
 * Asks the model to review the contradiction candidates.
 *
 * Returns the surviving insights and a note when the pass could not run. A
 * rejected candidate is dropped; a confirmed one is annotated with the model's
 * reason and marked as MODEL-judged, so the dashboard can say who decided.
 */
async function judgeContradictions(
  brand: Brand,
  insights: readonly AnalysisInsight[],
): Promise<{ insights: AnalysisInsight[]; judged: boolean; note: string | null }> {
  const candidates = insights
    .filter((insight) => insight.kind === "CONTRADICTION")
    .slice(0, MAX_JUDGED_CANDIDATES);

  if (candidates.length === 0) return { insights: [...insights], judged: false, note: null };

  const byId = new Map(
    candidates.map((insight, index) => [`c${index + 1}`, insight] as const),
  );

  try {
    const output = await getAIProvider().generateText({
      system: CONTRADICTION_JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: contradictionJudgeUserPrompt(
            brand,
            [...byId.entries()].map(([id, insight]) => ({
              id,
              internal: `${insight.evidence.internalTitles?.[0] ?? ""} — ${insight.summary}`,
              external: `${insight.evidence.externalLabels?.[0] ?? ""} — ${insight.explanation}`,
              occurrences: insight.evidence.externalOccurrences ?? 0,
              lastSeen: insight.evidence.lastSeenAt ?? null,
            })),
          ),
        },
      ],
      maxTokens: 1500,
      temperature: 0,
      json: true,
    });

    const cleaned = output.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = contradictionJudgementSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) {
      return {
        insights: [...insights],
        judged: false,
        note: "The contradiction review did not return a usable answer; the rule-based verdicts were kept.",
      };
    }

    const verdicts = new Map(parsed.data.verdicts.map((verdict) => [verdict.id, verdict]));
    const reviewed: AnalysisInsight[] = [];

    for (const insight of insights) {
      if (insight.kind !== "CONTRADICTION") {
        reviewed.push(insight);
        continue;
      }

      const id = [...byId.entries()].find(([, value]) => value === insight)?.[0];
      const verdict = id ? verdicts.get(id) : undefined;

      // Not reviewed (beyond the cap, or absent from the answer): keep it as a
      // heuristic finding rather than dropping evidence we did gather.
      if (!verdict) {
        reviewed.push(insight);
        continue;
      }
      if (!verdict.contradiction) continue;

      reviewed.push({
        ...insight,
        explanation: verdict.reason
          ? `${insight.explanation} Reviewed: ${verdict.reason}`
          : insight.explanation,
        score: Number(((insight.score + verdict.confidence) / 2).toFixed(4)),
        components: [
          ...insight.components,
          {
            name: "reviewed contradiction",
            value: verdict.confidence,
            weight: 0.2,
            detail: verdict.reason || "confirmed on review",
          },
        ],
      });
    }

    return { insights: reviewed, judged: true, note: null };
  } catch (error) {
    return {
      insights: [...insights],
      judged: false,
      note: `The contradiction review could not run (${
        error instanceof Error ? error.message : "unknown error"
      }); the rule-based verdicts were kept.`,
    };
  }
}

export async function runBrandCrossAnalysis(
  admin: SupabaseClient,
  brand: Brand,
): Promise<AnalysisSummary> {
  const startedAt = new Date().toISOString();

  const [internal, external, observations, signals] = await Promise.all([
    loadInternalClaims(admin, brand.id),
    loadExternalThemes(admin, brand.id),
    listObservationPoints(admin, brand.id),
    listContentSignals(admin, brand.id),
  ]);

  const toneDocuments = signals
    .filter((signal) => signal.tone.length > 0)
    .map((signal) => ({ at: signal.publishedAt ?? startedAt, terms: signal.tone }));

  const analysis = runCrossAnalysis({
    internal,
    external,
    observations,
    toneDocuments,
    totalExternalSources: new Set(signals.map((signal) => signal.sourceId)).size,
  });

  const reviewed = await judgeContradictions(brand, analysis.insights);
  const notes = reviewed.note ?? "";
  const status: AnalysisSummary["status"] = reviewed.note ? "PARTIAL" : "OK";

  // Replace rather than append: the dashboard shows the current reading, and a
  // stale insight next to a fresh one would be worse than none.
  const { error: clearError } = await admin.from("brand_insights").delete().eq("brand_id", brand.id);
  if (clearError) throw new DatabaseError("The previous analysis could not be cleared.", clearError);

  if (reviewed.insights.length > 0) {
    const { error: insertError } = await admin.from("brand_insights").insert(
      reviewed.insights.map((insight) => ({
        brand_id: brand.id,
        kind: insight.kind,
        title: insight.title.slice(0, 300),
        summary: insight.summary.slice(0, 1000),
        explanation: insight.explanation.slice(0, 4000),
        score: insight.score,
        components: insight.components,
        evidence: insight.evidence,
        internal_entry_ids: insight.internalEntryIds,
        external_entry_ids: insight.externalEntryIds,
        judged_by: insight.kind === "CONTRADICTION" && reviewed.judged ? "MODEL" : "HEURISTIC",
      })),
    );

    if (insertError) throw new DatabaseError("The analysis could not be stored.", insertError);
  }

  const { data: run, error: runError } = await admin
    .from("external_analysis_runs")
    .insert({
      brand_id: brand.id,
      status,
      notes,
      insight_count: reviewed.insights.length,
      internal_entry_count: analysis.stats.internalCount,
      external_entry_count: analysis.stats.externalCount,
      external_source_count: new Set(observations.map((point) => point.sourceId)).size,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError || !run) throw new DatabaseError("The analysis run could not be recorded.", runError);

  return {
    runId: (run as { id: string }).id,
    status,
    insightCount: reviewed.insights.length,
    internalCount: analysis.stats.internalCount,
    externalCount: analysis.stats.externalCount,
    sourceCount: new Set(observations.map((point) => point.sourceId)).size,
    notes,
  };
}
