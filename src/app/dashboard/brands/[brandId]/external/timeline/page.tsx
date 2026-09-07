import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import { listContentSignals, listObservationPoints } from "@/lib/external/queries";
import {
  bucketObservations,
  dominantThemes,
  periodKey,
  termShift,
  themeTrajectories,
  windowStart,
} from "@/lib/external/timeline";
import type { Granularity } from "@/lib/external/timeline";
import { ThemeTimeline, VolumeChart } from "@/components/external/timeline-chart";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

const GRANULARITY_OPTIONS: Array<{ value: Granularity; label: string }> = [
  { value: "MONTH", label: "Monthly" },
  { value: "QUARTER", label: "Quarterly" },
  { value: "YEAR", label: "Yearly" },
];

function parseGranularity(value: string | undefined): Granularity {
  if (value === "MONTH" || value === "YEAR") return value;
  return "QUARTER";
}

export default async function ExternalTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ g?: string; period?: string }>;
}) {
  const [{ brandId }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireUser();

  const [observations, signals] = await Promise.all([
    listObservationPoints(supabase, brandId),
    listContentSignals(supabase, brandId),
  ]);

  const granularity = parseGranularity(query.g);
  const base = `/dashboard/brands/${brandId}/external/timeline`;

  if (observations.length === 0) {
    return (
      <Panel>
        <PanelHeader title="Timeline" />
        <EmptyState
          title="No dated statements yet"
          description="The timeline is built from the publication dates of the content that has been read. Add public content and extract its themes first."
        />
      </Panel>
    );
  }

  const buckets = bucketObservations(observations, granularity);
  const trajectories = themeTrajectories(observations, { granularity }).slice(0, 15);
  const periods = buckets.map((bucket) => bucket.period);

  const selectedPeriod =
    query.period && periods.includes(query.period) ? query.period : periods[periods.length - 1];
  const dominant = selectedPeriod ? dominantThemes(observations, selectedPeriod, granularity) : [];

  const cutoff = windowStart(new Date(), 12);
  const toneDocuments = signals
    .filter((signal) => signal.tone.length > 0 && signal.publishedAt)
    .map((signal) => ({ at: signal.publishedAt as string, terms: signal.tone }));
  const toneShifts = termShift(toneDocuments, cutoff)
    .filter((shift) => Math.abs(shift.delta) >= 0.05)
    .slice(0, 8);

  return (
    <div className="space-y-8">
      <Panel>
        <PanelHeader
          title="Volume of public communication"
          description={`${observations.length} extracted statements across ${buckets.length} periods`}
          action={
            <div className="flex gap-1">
              {GRANULARITY_OPTIONS.map((option) => (
                <Link
                  key={option.value}
                  href={`${base}?g=${option.value}`}
                  className={cn(
                    "border px-2 py-1 text-xs",
                    granularity === option.value
                      ? "border-ink bg-ink text-paper"
                      : "border-rule text-ink-muted hover:border-ink hover:text-ink",
                  )}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          }
        />
        <VolumeChart buckets={buckets} />
      </Panel>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <Panel>
          <PanelHeader
            title="Themes over time"
            description="Each row is one theme. The bars are how often it was said in that period."
          />
          <ThemeTimeline trajectories={trajectories} periods={periods} />
        </Panel>

        <aside className="space-y-8">
          <Panel className="h-fit">
            <PanelHeader
              title={selectedPeriod ? `Dominant in ${selectedPeriod}` : "Dominant"}
              description="Pick another period below."
            />

            {dominant.length === 0 ? (
              <p className="px-5 py-4 text-xs text-ink-faint">Nothing was said in this period.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {dominant.map((theme) => (
                  <li key={theme.entryId} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate text-xs text-ink">{theme.label}</span>
                    <span className="font-mono text-[0.6875rem] text-ink-faint">
                      {theme.count} · {Math.round(theme.share * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-1 border-t border-rule px-5 py-3">
              {periods.map((period) => (
                <Link
                  key={period}
                  href={`${base}?g=${granularity}&period=${period}`}
                  className={cn(
                    "border px-1.5 py-0.5 font-mono text-[0.625rem]",
                    period === selectedPeriod
                      ? "border-ink bg-ink text-paper"
                      : "border-rule text-ink-muted hover:border-ink hover:text-ink",
                  )}
                >
                  {period}
                </Link>
              ))}
            </div>
          </Panel>

          <Panel className="h-fit">
            <PanelHeader
              title="Tone, before and now"
              description={`Share of contents using each word, ${periodKey(cutoff.toISOString(), "MONTH")} as the cut`}
            />

            {toneShifts.length === 0 ? (
              <p className="px-5 py-4 text-xs text-ink-faint">
                Not enough dated tone readings to compare periods.
              </p>
            ) : (
              <ul className="divide-y divide-rule">
                {toneShifts.map((shift) => (
                  <li key={shift.term} className="px-5 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink">{shift.term}</span>
                      <span
                        className={cn(
                          "font-mono text-[0.6875rem]",
                          shift.delta > 0 ? "text-positive" : "text-warning",
                        )}
                      >
                        {Math.round(shift.earlier * 100)}% → {Math.round(shift.recent * 100)}%
                      </span>
                    </div>
                    <div className="mt-1.5 flex h-1 w-full bg-rule">
                      <span
                        className="block h-full bg-signal"
                        style={{ width: `${Math.min(shift.recent, 1) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
