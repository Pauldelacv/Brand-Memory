"use client";

import { useState } from "react";
import { Tag } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { INSIGHT_KIND_LABELS } from "@/types/external";
import type { BrandInsight } from "@/types/external";

/**
 * Insight attribution, the counterpart of the citation panel on the generation
 * screen: every finding opens onto the numbers that produced it. A score with
 * no components behind it would be exactly the arbitrary number this product
 * is not supposed to produce.
 */
export function InsightList({ insights }: { insights: BrandInsight[] }) {
  if (insights.length === 0) {
    return (
      <p className="px-5 py-6 text-xs text-ink-faint">
        Nothing in this category. Run the analysis after reading public content.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-rule">
      {insights.map((insight) => (
        <InsightRow key={insight.id} insight={insight} />
      ))}
    </ul>
  );
}

function InsightRow({ insight }: { insight: BrandInsight }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{INSIGHT_KIND_LABELS[insight.kind]}</Tag>
            {insight.judgedBy === "MODEL" ? (
              <Tag className="border-signal text-signal">reviewed</Tag>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-medium text-ink">{insight.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{insight.summary}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm text-ink" title="Score">
            {Math.round(insight.score * 100)}
          </span>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-xs text-signal underline underline-offset-4"
          >
            {open ? "Hide why" : "Why"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 border-t border-rule pt-4">
          <p className="max-w-3xl text-xs leading-relaxed text-ink-muted">{insight.explanation}</p>

          {insight.components.length > 0 ? (
            <dl className="mt-4 space-y-2">
              {insight.components.map((part) => (
                <div key={part.name} className="flex items-center gap-3">
                  <dt className="w-48 shrink-0 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-faint uppercase">
                    {part.name}
                  </dt>
                  <dd className="flex flex-1 items-center gap-3">
                    <span className="block h-1 w-24 shrink-0 bg-rule">
                      <span
                        className="block h-full bg-signal"
                        style={{ width: `${Math.max(0, Math.min(1, part.value)) * 100}%` }}
                      />
                    </span>
                    <span className="font-mono text-[0.6875rem] text-ink-faint">
                      ×{part.weight.toFixed(2)}
                    </span>
                    <span className="text-xs text-ink-muted">{part.detail}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {insight.evidence.periods && insight.evidence.periods.length > 0 ? (
            <PeriodStrip periods={insight.evidence.periods} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function PeriodStrip({ periods }: { periods: Array<{ period: string; count: number }> }) {
  const peak = Math.max(...periods.map((entry) => entry.count), 1);

  return (
    <div className="mt-4">
      <p className="label">Over time</p>
      <div className="mt-2 flex items-end gap-1" style={{ height: "44px" }}>
        {periods.map((entry) => (
          <div key={entry.period} className="flex w-8 flex-col items-center justify-end gap-1">
            <div
              className={cn("w-full", entry.count > 0 ? "bg-signal" : "bg-rule")}
              style={{ height: `${Math.max((entry.count / peak) * 100, entry.count > 0 ? 8 : 2)}%` }}
              title={`${entry.period}: ${entry.count}`}
            />
            <span className="font-mono text-[0.5625rem] text-ink-faint">
              {entry.period.replace(/^\d{2}/, "")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
