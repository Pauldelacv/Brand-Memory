import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import { listMemoryEntries, listSources } from "@/lib/db/queries";
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from "@/types/domain";
import type { MemoryCategory } from "@/types/domain";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { EntryCard } from "@/components/memory/entry-card";
import { ExtractionPanel } from "@/components/memory/extraction-panel";
import { cn } from "@/lib/cn";

function parseCategory(value: string | undefined): MemoryCategory | null {
  if (!value) return null;
  return (MEMORY_CATEGORIES as readonly string[]).includes(value)
    ? (value as MemoryCategory)
    : null;
}

export default async function MemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const [{ brandId }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireUser();

  const [entries, sources] = await Promise.all([
    listMemoryEntries(supabase, brandId),
    listSources(supabase, brandId),
  ]);

  const active = parseCategory(query.category);
  const visible = active ? entries.filter((entry) => entry.category === active) : entries;
  const readySources = sources.filter((source) => source.status === "READY").length;
  const base = `/dashboard/brands/${brandId}/memory`;

  const counts = new Map<MemoryCategory, number>();
  for (const entry of entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr_320px]">
      <nav className="h-fit border border-rule bg-surface">
        <p className="label border-b border-rule px-4 py-3">Knowledge map</p>
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
          {MEMORY_CATEGORIES.map((category) => (
            <li key={category}>
              <Link
                href={`${base}?category=${category}`}
                className={cn(
                  "flex items-center justify-between px-4 py-2 text-xs hover:bg-paper",
                  active === category ? "bg-paper font-medium text-ink" : "text-ink-muted",
                )}
              >
                <span>{MEMORY_CATEGORY_LABELS[category]}</span>
                <span className="font-mono text-[0.6875rem] text-ink-faint">
                  {counts.get(category) ?? 0}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Panel>
        <PanelHeader
          title={active ? MEMORY_CATEGORY_LABELS[active] : "Brand memory"}
          description={`${visible.length} ${visible.length === 1 ? "entry" : "entries"}`}
        />

        {visible.length === 0 ? (
          <EmptyState
            title={active ? "Nothing in this category yet" : "The memory is empty"}
            description="Run extraction over the processed sources, or write an entry by hand. Extraction is a suggestion — anything you edit takes precedence over it."
          />
        ) : (
          <div className="divide-y divide-rule">
            {visible.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </Panel>

      <Panel className="h-fit">
        <PanelHeader title="Build the memory" description={`${readySources} sources ready`} />
        <ExtractionPanel brandId={brandId} readySources={readySources} />
      </Panel>
    </div>
  );
}
