"use client";

import { useActionState } from "react";
import { runConsistencyAnalysis, runExternalExtraction } from "@/actions/external";
import type { ConsistencyResult, ExtractionStarted } from "@/actions/external";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/actions/result";
import type { ExternalAnalysisRun } from "@/types/external";

/**
 * The two jobs behind the consistency view: reading stored content into themes,
 * then measuring the internal memory against them.
 */
export function AnalysisPanel({
  brandId,
  lastRun,
  pendingExtraction,
  readyContents,
  internalEntries,
}: {
  brandId: string;
  lastRun: ExternalAnalysisRun | null;
  pendingExtraction: number;
  readyContents: number;
  internalEntries: number;
}) {
  const [extractionState, extractionAction] = useActionState<
    ActionResult<ExtractionStarted> | null,
    FormData
  >(runExternalExtraction, null);

  const [analysisState, analysisAction] = useActionState<ActionResult<ConsistencyResult> | null, FormData>(
    runConsistencyAnalysis,
    null,
  );

  return (
    <div className="space-y-5 px-5 py-5">
      <dl className="divide-y divide-rule border border-rule">
        {[
          ["Public contents read", readyContents],
          ["Awaiting extraction", pendingExtraction],
          ["Internal memory entries", internalEntries],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex items-center justify-between px-4 py-2.5">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="font-mono text-sm text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {pendingExtraction > 0 ? (
        <form action={extractionAction} className="space-y-2">
          <input type="hidden" name="brandId" value={brandId} />
          <p className="text-xs leading-relaxed text-ink-muted">
            {pendingExtraction} stored content{pendingExtraction === 1 ? " has" : "s have"} not been
            read into themes yet.
          </p>
          <SubmitButton size="sm" variant="secondary" pendingLabel="Starting…">
            Extract themes
          </SubmitButton>
        </form>
      ) : null}

      {extractionState && !extractionState.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">
          {extractionState.error}
        </p>
      ) : null}
      {extractionState?.ok ? (
        <p className="border border-positive bg-surface px-3 py-2 text-xs text-positive">
          Reading {extractionState.data.pending} content
          {extractionState.data.pending === 1 ? "" : "s"} in the background.
        </p>
      ) : null}

      <form action={analysisAction} className="space-y-2 border-t border-rule pt-4">
        <input type="hidden" name="brandId" value={brandId} />
        <p className="text-xs leading-relaxed text-ink-muted">
          Compares every internal memory entry against the themes actually communicated, and replaces
          the previous reading.
        </p>
        <SubmitButton size="sm" pendingLabel="Analysing…" disabled={internalEntries === 0}>
          Run consistency analysis
        </SubmitButton>
        {internalEntries === 0 ? (
          <p className="text-xs text-ink-faint">
            There is no internal memory to compare against yet. Build it under Brand memory first.
          </p>
        ) : null}
      </form>

      {analysisState && !analysisState.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">
          {analysisState.error}
        </p>
      ) : null}

      {analysisState?.ok ? (
        <div
          className={
            analysisState.data.status === "PARTIAL"
              ? "border border-warning bg-surface px-3 py-2 text-xs text-ink-muted"
              : "border border-positive bg-surface px-3 py-2 text-xs text-positive"
          }
        >
          <p>
            {analysisState.data.insightCount} finding
            {analysisState.data.insightCount === 1 ? "" : "s"} from{" "}
            {analysisState.data.internalCount} internal entries and {analysisState.data.externalCount}{" "}
            public themes across {analysisState.data.sourceCount} sources.
          </p>
          {analysisState.data.notes ? <p className="mt-1">{analysisState.data.notes}</p> : null}
        </div>
      ) : null}

      {lastRun ? (
        <p className="border-t border-rule pt-3 font-mono text-[0.6875rem] text-ink-faint">
          Last run {new Date(lastRun.startedAt).toLocaleString()} · {lastRun.insightCount} findings
          {lastRun.status !== "OK" ? ` · ${lastRun.status.toLowerCase()}` : ""}
        </p>
      ) : null}
    </div>
  );
}
