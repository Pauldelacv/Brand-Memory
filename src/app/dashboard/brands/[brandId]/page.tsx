import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import { getOwnedBrand, listMemoryEntries, listSources } from "@/lib/db/queries";
import { computeCompleteness, summariseSources } from "@/lib/brand-health";
import { MEMORY_CATEGORY_LABELS } from "@/types/domain";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { StatusPill, Tag } from "@/components/ui/status";
import { buttonVariants } from "@/components/ui/button";

export default async function BrandOverviewPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { supabase } = await requireUser();

  const [brand, sources, memory] = await Promise.all([
    getOwnedBrand(supabase, brandId),
    listSources(supabase, brandId),
    listMemoryEntries(supabase, brandId),
  ]);

  const completeness = computeCompleteness(memory);
  const breakdown = summariseSources(sources);
  const base = `/dashboard/brands/${brand.id}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        <Panel>
          <PanelHeader
            title="Brand memory"
            description={`${memory.length} entries across ${completeness.covered.length} of 9 categories`}
            action={
              <Link href={`${base}/memory`} className="text-xs text-signal underline underline-offset-4">
                Open memory
              </Link>
            }
          />

          {memory.length === 0 ? (
            <EmptyState
              title="Nothing extracted yet"
              description="Upload brand guidelines, decks or tone-of-voice documents, then run extraction to build the structured memory."
              action={
                <Link href={`${base}/sources`} className={buttonVariants({ variant: "primary", size: "sm" })}>
                  Upload sources
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-rule">
              {memory.slice(0, 6).map((entry) => (
                <li key={entry.id} className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Tag>{MEMORY_CATEGORY_LABELS[entry.category]}</Tag>
                    {entry.origin === "USER_EDITED" ? (
                      <Tag className="border-signal text-signal">Edited</Tag>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-medium text-ink">{entry.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                    {entry.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Latest sources"
            description={`${breakdown.total} uploaded · ${breakdown.chunks} indexed passages`}
            action={
              <Link href={`${base}/sources`} className="text-xs text-signal underline underline-offset-4">
                Manage sources
              </Link>
            }
          />

          {sources.length === 0 ? (
            <EmptyState
              title="No sources"
              description="Brand Memory is only as good as what it has read. Start with the guidelines."
            />
          ) : (
            <ul className="divide-y divide-rule">
              {sources.slice(0, 6).map((source) => (
                <li key={source.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{source.filename}</p>
                    <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-faint">
                      {new Date(source.createdAt).toLocaleDateString()} · {source.chunkCount} passages
                    </p>
                  </div>
                  <StatusPill status={source.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <aside className="space-y-8">
        <Panel>
          <PanelHeader title="Completeness" description="How much of the memory model is covered" />
          <div className="px-5 py-5">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-4xl text-ink">
                {Math.round(completeness.score * 100)}%
              </span>
              <span className="label">
                {completeness.covered.length}/9 categories
              </span>
            </div>

            <div className="mt-4 h-1.5 w-full bg-rule">
              <div className="h-full bg-signal" style={{ width: `${completeness.score * 100}%` }} />
            </div>

            {completeness.missing.length > 0 ? (
              <div className="mt-5">
                <p className="label">Not yet covered</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {completeness.missingLabels.map((label) => (
                    <Tag key={label}>{label}</Tag>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-xs text-positive">Every category has at least one entry.</p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Processing" />
          <dl className="divide-y divide-rule">
            {[
              ["Ready", breakdown.ready],
              ["In progress", breakdown.processing],
              ["Failed", breakdown.failed],
              ["Indexed passages", breakdown.chunks],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-5 py-3">
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="font-mono text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title="Profile" description="Used in every generation prompt" />
          <dl className="divide-y divide-rule">
            {[
              ["Positioning", brand.positioning],
              ["Audience", brand.audience],
            ].map(([label, value]) => (
              <div key={label} className="px-5 py-3">
                <dt className="label">{label}</dt>
                <dd className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {value || "Not set."}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </aside>
    </div>
  );
}
