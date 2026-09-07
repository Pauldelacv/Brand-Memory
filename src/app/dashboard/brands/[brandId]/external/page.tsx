import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import { getOwnedBrand } from "@/lib/db/queries";
import {
  listBrandInsights,
  listContentSignals,
  listExternalMemoryEntries,
  listExternalSources,
  listObservationPoints,
} from "@/lib/external/queries";
import { bucketObservations, themeTrajectories } from "@/lib/external/timeline";
import { VolumeChart, TrendTag } from "@/components/external/timeline-chart";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { Tag } from "@/components/ui/status";
import { buttonVariants } from "@/components/ui/button";
import { INSIGHT_KIND_LABELS } from "@/types/external";

export default async function ExternalOverviewPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { supabase } = await requireUser();

  const [brand, sources, entries, observations, signals, insights] = await Promise.all([
    getOwnedBrand(supabase, brandId),
    listExternalSources(supabase, brandId),
    listExternalMemoryEntries(supabase, brandId),
    listObservationPoints(supabase, brandId),
    listContentSignals(supabase, brandId),
    listBrandInsights(supabase, brandId),
  ]);

  const base = `/dashboard/brands/${brand.id}/external`;
  const ready = sources.filter((source) => source.status === "READY");
  const duplicates = sources.filter((source) => source.status === "DUPLICATE");
  const failed = sources.filter((source) => source.status === "FAILED");
  const publishers = new Set(sources.map((source) => source.publisher).filter(Boolean));
  const owned = sources.filter((source) => source.mediaClass === "OWNED").length;

  const trajectories = themeTrajectories(observations, { granularity: "QUARTER" });
  const buckets = bucketObservations(observations, "QUARTER");
  const emerging = trajectories.filter((trajectory) => trajectory.trend === "NEW" || trajectory.trend === "RISING");
  const fading = trajectories.filter((trajectory) => trajectory.trend === "FALLING" || trajectory.trend === "DORMANT");

  const dated = signals.map((signal) => signal.publishedAt).filter((value): value is string => value !== null).sort();
  const toneWords = countTone(signals.map((signal) => signal.tone));

  if (sources.length === 0) {
    return (
      <Panel>
        <PanelHeader title="Nothing public has been read yet" />
        <EmptyState
          title="Start with what the brand publishes"
          description="Add its newsroom feed, its sitemap, or a handful of articles. Once there is public content, this section shows what the brand has actually been saying, and where that diverges from its own memory."
          action={
            <Link href={`${base}/sources`} className={buttonVariants({ variant: "primary", size: "sm" })}>
              Add public content
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        <Panel>
          <PanelHeader
            title="Public communication over time"
            description={
              dated.length > 0
                ? `${observations.length} statements, ${dated[0]?.slice(0, 4)} to ${dated[dated.length - 1]?.slice(0, 4)}`
                : "No publication dates were found on this content"
            }
            action={
              <Link href={`${base}/timeline`} className="text-xs text-signal underline underline-offset-4">
                Open timeline
              </Link>
            }
          />
          <VolumeChart buckets={buckets} />
        </Panel>

        <Panel>
          <PanelHeader
            title="Dominant messages"
            description={`${entries.length} themes extracted from ${ready.length} contents`}
            action={
              <Link href={`${base}/messages`} className="text-xs text-signal underline underline-offset-4">
                All messages
              </Link>
            }
          />

          {trajectories.length === 0 ? (
            <EmptyState
              title="No themes yet"
              description="Content has been stored but not yet read into themes. Run the extraction from the Consistency screen."
            />
          ) : (
            <ul className="divide-y divide-rule">
              {trajectories.slice(0, 8).map((trajectory) => (
                <li key={trajectory.entryId} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{trajectory.label}</p>
                    <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-faint">
                      {trajectory.total} statements · {trajectory.sourceCount} sources ·{" "}
                      {trajectory.firstSeenAt.slice(0, 7)} → {trajectory.lastSeenAt.slice(0, 7)}
                    </p>
                  </div>
                  <TrendTag trend={trajectory.trend} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {insights.length > 0 ? (
          <Panel>
            <PanelHeader
              title="What the analysis found"
              description={`${insights.length} findings against the internal memory`}
              action={
                <Link href={`${base}/consistency`} className="text-xs text-signal underline underline-offset-4">
                  Open consistency
                </Link>
              }
            />
            <ul className="divide-y divide-rule">
              {insights.slice(0, 5).map((insight) => (
                <li key={insight.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Tag>{INSIGHT_KIND_LABELS[insight.kind]}</Tag>
                    <span className="font-mono text-[0.6875rem] text-ink-faint">
                      {Math.round(insight.score * 100)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink">{insight.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{insight.summary}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      <aside className="space-y-8">
        <Panel>
          <PanelHeader title="Corpus" />
          <dl className="divide-y divide-rule">
            {[
              ["Contents read", ready.length],
              ["Duplicates set aside", duplicates.length],
              ["Could not be read", failed.length],
              ["Distinct publishers", publishers.size],
              ["Owned media", owned],
              ["Extracted statements", observations.length],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between px-5 py-2.5">
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="font-mono text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title="Emerging" description="New or rising in the last 12 months" />
          {emerging.length === 0 ? (
            <p className="px-5 py-4 text-xs text-ink-faint">Nothing is rising sharply.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {emerging.slice(0, 6).map((trajectory) => (
                <li key={trajectory.entryId} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="truncate text-xs text-ink">{trajectory.label}</span>
                  <span className="font-mono text-[0.6875rem] text-ink-faint">
                    {trajectory.recentCount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Fading" description="Falling away or gone quiet" />
          {fading.length === 0 ? (
            <p className="px-5 py-4 text-xs text-ink-faint">Nothing has dropped off.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {fading.slice(0, 6).map((trajectory) => (
                <li key={trajectory.entryId} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="truncate text-xs text-ink">{trajectory.label}</span>
                  <span className="font-mono text-[0.6875rem] text-ink-faint">
                    last {trajectory.lastSeenAt.slice(0, 7)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Tone in public" description="Read from the published content itself" />
          {toneWords.length === 0 ? (
            <p className="px-5 py-4 text-xs text-ink-faint">No tone has been read yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 px-5 py-4">
              {toneWords.slice(0, 12).map(([word, count]) => (
                <Tag key={word}>
                  {word} · {count}
                </Tag>
              ))}
            </div>
          )}
        </Panel>
      </aside>
    </div>
  );
}

function countTone(tones: string[][]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const tone of tones) {
    for (const word of tone) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
