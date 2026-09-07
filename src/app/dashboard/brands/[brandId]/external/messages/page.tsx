import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import { listExternalMemoryEntries, listObservationPoints } from "@/lib/external/queries";
import { themeTrajectories } from "@/lib/external/timeline";
import { TrendTag } from "@/components/external/timeline-chart";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { Tag } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { EXTERNAL_MEMORY_KINDS, EXTERNAL_MEMORY_KIND_LABELS } from "@/types/external";
import type { ExternalMemoryKind } from "@/types/external";

function parseKind(value: string | undefined): ExternalMemoryKind | null {
  if (!value) return null;
  return (EXTERNAL_MEMORY_KINDS as readonly string[]).includes(value)
    ? (value as ExternalMemoryKind)
    : null;
}

export default async function ExternalMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const [{ brandId }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireUser();

  const [entries, observations] = await Promise.all([
    listExternalMemoryEntries(supabase, brandId),
    listObservationPoints(supabase, brandId),
  ]);

  const active = parseKind(query.kind);
  const visible = active ? entries.filter((entry) => entry.kind === active) : entries;
  const trajectories = new Map(
    themeTrajectories(observations, { granularity: "QUARTER" }).map((trajectory) => [
      trajectory.entryId,
      trajectory,
    ]),
  );

  const counts = new Map<ExternalMemoryKind, number>();
  for (const entry of entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);

  const base = `/dashboard/brands/${brandId}/external/messages`;
  const usedKinds = EXTERNAL_MEMORY_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0);

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <nav className="h-fit border border-rule bg-surface">
        <p className="label border-b border-rule px-4 py-3">What was said</p>
        <ul>
          <li>
            <Link
              href={base}
              className={cn(
                "flex items-center justify-between px-4 py-2 text-xs hover:bg-paper",
                active === null ? "bg-paper font-medium text-ink" : "text-ink-muted",
              )}
            >
              <span>Everything</span>
              <span className="font-mono text-[0.6875rem] text-ink-faint">{entries.length}</span>
            </Link>
          </li>
          {usedKinds.map((kind) => (
            <li key={kind}>
              <Link
                href={`${base}?kind=${kind}`}
                className={cn(
                  "flex items-center justify-between px-4 py-2 text-xs hover:bg-paper",
                  active === kind ? "bg-paper font-medium text-ink" : "text-ink-muted",
                )}
              >
                <span>{EXTERNAL_MEMORY_KIND_LABELS[kind]}</span>
                <span className="font-mono text-[0.6875rem] text-ink-faint">{counts.get(kind)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Panel>
        <PanelHeader
          title={active ? EXTERNAL_MEMORY_KIND_LABELS[active] : "Public messages"}
          description={`${visible.length} ${visible.length === 1 ? "theme" : "themes"}, counted across every content they appear in`}
        />

        {visible.length === 0 ? (
          <EmptyState
            title="Nothing extracted yet"
            description="Public content is stored but has not been read into themes, or none has been added. Run the extraction from the Consistency screen."
          />
        ) : (
          <ul className="divide-y divide-rule">
            {visible.map((entry) => {
              const trajectory = trajectories.get(entry.id);

              return (
                <li key={entry.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag>{EXTERNAL_MEMORY_KIND_LABELS[entry.kind]}</Tag>
                        {trajectory ? <TrendTag trend={trajectory.trend} /> : null}
                      </div>
                      <p className="mt-2 text-sm font-medium text-ink">{entry.title}</p>
                      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">
                        {entry.content}
                      </p>
                    </div>

                    <dl className="shrink-0 text-right">
                      <div>
                        <dt className="label">Occurrences</dt>
                        <dd className="font-mono text-lg text-ink">{entry.occurrenceCount}</dd>
                      </div>
                      <div className="mt-2">
                        <dt className="label">Sources</dt>
                        <dd className="font-mono text-sm text-ink">{entry.sourceCount}</dd>
                      </div>
                    </dl>
                  </div>

                  <p className="mt-3 border-t border-rule pt-2.5 font-mono text-[0.6875rem] text-ink-faint">
                    First said {entry.firstSeenAt ? entry.firstSeenAt.slice(0, 10) : "—"} · last said{" "}
                    {entry.lastSeenAt ? entry.lastSeenAt.slice(0, 10) : "—"}
                    {trajectory ? ` · ${trajectory.recentCount} in the last 12 months` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
