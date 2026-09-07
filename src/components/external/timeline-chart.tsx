import { cn } from "@/lib/cn";
import type { PeriodBucket, ThemeTrajectory } from "@/lib/external/timeline";

/**
 * Publication volume over time. Bars, not decoration: the empty periods are
 * filled in by the aggregation, and a gap in publishing is part of the answer.
 */
export function VolumeChart({ buckets }: { buckets: PeriodBucket[] }) {
  if (buckets.length === 0) {
    return <p className="px-5 py-6 text-xs text-ink-faint">Nothing dated has been read yet.</p>;
  }

  const peak = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div className="overflow-x-auto px-5 py-5">
      <div className="flex min-w-fit items-end gap-1.5" style={{ height: "140px" }}>
        {buckets.map((bucket) => (
          <div key={bucket.period} className="flex w-10 shrink-0 flex-col items-center justify-end gap-1.5">
            <span className="font-mono text-[0.6875rem] text-ink-faint">
              {bucket.count > 0 ? bucket.count : ""}
            </span>
            <div
              className={cn("w-full", bucket.count > 0 ? "bg-signal" : "bg-rule")}
              style={{ height: `${Math.max((bucket.count / peak) * 100, bucket.count > 0 ? 4 : 1)}%` }}
              title={`${bucket.label}: ${bucket.count} statements from ${bucket.sourceCount} sources`}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex min-w-fit gap-1.5">
        {buckets.map((bucket) => (
          <span
            key={bucket.period}
            className="w-10 shrink-0 text-center font-mono text-[0.625rem] text-ink-faint"
          >
            {bucket.period.replace(/^\d{2}/, "")}
          </span>
        ))}
      </div>
    </div>
  );
}

const TREND_STYLES: Record<ThemeTrajectory["trend"], string> = {
  NEW: "border-signal text-signal",
  RISING: "border-positive text-positive",
  STABLE: "border-rule-strong text-ink-muted",
  FALLING: "border-warning text-warning",
  DORMANT: "border-critical text-critical",
};

const TREND_LABELS: Record<ThemeTrajectory["trend"], string> = {
  NEW: "new",
  RISING: "rising",
  STABLE: "stable",
  FALLING: "falling",
  DORMANT: "dormant",
};

export function TrendTag({ trend }: { trend: ThemeTrajectory["trend"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-0.5 font-mono text-[0.6875rem] tracking-[0.08em] uppercase",
        TREND_STYLES[trend],
      )}
    >
      {TREND_LABELS[trend]}
    </span>
  );
}

/** One row per theme: its shape over time, next to its counts. */
export function ThemeTimeline({
  trajectories,
  periods,
}: {
  trajectories: ThemeTrajectory[];
  periods: string[];
}) {
  if (trajectories.length === 0) {
    return (
      <p className="px-5 py-6 text-xs text-ink-faint">
        No themes have been extracted yet. Read some public content first.
      </p>
    );
  }

  const peak = Math.max(
    ...trajectories.flatMap((trajectory) => trajectory.buckets.map((bucket) => bucket.count)),
    1,
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="label px-5 py-2.5 font-normal">Theme</th>
            <th className="label px-5 py-2.5 font-normal">Trend</th>
            {periods.map((period) => (
              <th key={period} className="label px-1 py-2.5 text-center font-normal">
                {period.replace(/^\d{2}/, "")}
              </th>
            ))}
            <th className="label px-5 py-2.5 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {trajectories.map((trajectory) => {
            const byPeriod = new Map(trajectory.buckets.map((bucket) => [bucket.period, bucket.count]));

            return (
              <tr key={trajectory.entryId}>
                <td className="px-5 py-2.5">
                  <p className="text-sm text-ink">{trajectory.label}</p>
                  <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-faint">
                    {trajectory.firstSeenAt.slice(0, 7)} → {trajectory.lastSeenAt.slice(0, 7)} ·{" "}
                    {trajectory.sourceCount} sources
                  </p>
                </td>
                <td className="px-5 py-2.5">
                  <TrendTag trend={trajectory.trend} />
                </td>
                {periods.map((period) => {
                  const count = byPeriod.get(period) ?? 0;
                  return (
                    <td key={period} className="px-1 py-2.5 align-middle">
                      <div className="mx-auto flex h-8 w-6 items-end" title={`${period}: ${count}`}>
                        <div
                          className={cn("w-full", count > 0 ? "bg-signal" : "bg-rule")}
                          style={{ height: `${Math.max((count / peak) * 100, count > 0 ? 8 : 2)}%` }}
                        />
                      </div>
                    </td>
                  );
                })}
                <td className="px-5 py-2.5 text-right font-mono text-sm text-ink">{trajectory.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
