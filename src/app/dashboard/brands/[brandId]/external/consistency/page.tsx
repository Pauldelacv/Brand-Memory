import { requireUser } from "@/lib/db/server";
import { getOwnedBrand, listMemoryEntries } from "@/lib/db/queries";
import {
  latestAnalysisRun,
  listBrandInsights,
  listExternalSources,
} from "@/lib/external/queries";
import { AnalysisPanel } from "@/components/external/analysis-panel";
import { InsightList } from "@/components/external/insight-list";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { BRAND_INSIGHT_KINDS, INSIGHT_KIND_DESCRIPTIONS, INSIGHT_KIND_LABELS } from "@/types/external";
import type { BrandInsightKind } from "@/types/external";

/**
 * Internal memory measured against external reality.
 *
 * The order below is the order a brand team would want to read them in: what
 * disagrees first, then what is missing, then what is arriving, then what is
 * holding.
 */
const GROUP_ORDER: BrandInsightKind[] = [
  "CONTRADICTION",
  "MISSING_EXTERNAL",
  "DRIFT",
  "FORGOTTEN",
  "EMERGING",
  "OVERREPRESENTED",
  "TONE_DRIFT",
  "POSITIONING_EVOLUTION",
  "ALIGNED",
];

export default async function ConsistencyPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { supabase } = await requireUser();

  const [brand, insights, internalEntries, sources, lastRun] = await Promise.all([
    getOwnedBrand(supabase, brandId),
    listBrandInsights(supabase, brandId),
    listMemoryEntries(supabase, brandId),
    listExternalSources(supabase, brandId),
    latestAnalysisRun(supabase, brandId),
  ]);

  const ready = sources.filter((source) => source.status === "READY");
  const pendingExtraction = ready.filter((source) => source.entryCount === 0).length;

  const grouped = new Map<BrandInsightKind, typeof insights>();
  for (const kind of BRAND_INSIGHT_KINDS) grouped.set(kind, []);
  for (const insight of insights) grouped.get(insight.kind)?.push(insight);

  const counts = GROUP_ORDER.map((kind) => ({ kind, count: grouped.get(kind)?.length ?? 0 }));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        <Panel>
          <PanelHeader
            title="Internal memory → external reality"
            description={
              lastRun
                ? `${insights.length} findings from the run of ${new Date(lastRun.startedAt).toLocaleString()}`
                : "No analysis has been run yet"
            }
          />

          {insights.length === 0 ? (
            <EmptyState
              title="Nothing to compare yet"
              description="The analysis needs both halves: an internal memory built from the brand's own documents, and public content read into themes. Once both exist, run it from the panel on the right."
            />
          ) : (
            <div className="grid grid-cols-2 divide-x divide-y divide-rule border-t border-rule sm:grid-cols-3">
              {counts.map((entry) => (
                <div key={entry.kind} className="px-5 py-3">
                  <p className="label">{INSIGHT_KIND_LABELS[entry.kind]}</p>
                  <p className="mt-1 font-serif text-2xl text-ink">{entry.count}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {GROUP_ORDER.map((kind) => {
          const group = grouped.get(kind) ?? [];
          if (group.length === 0) return null;

          return (
            <Panel key={kind}>
              <PanelHeader
                title={INSIGHT_KIND_LABELS[kind]}
                description={INSIGHT_KIND_DESCRIPTIONS[kind]}
              />
              <InsightList insights={group} />
            </Panel>
          );
        })}
      </div>

      <aside className="space-y-8">
        <Panel className="h-fit">
          <PanelHeader title="Run the analysis" />
          <AnalysisPanel
            brandId={brand.id}
            lastRun={lastRun}
            pendingExtraction={pendingExtraction}
            readyContents={ready.length}
            internalEntries={internalEntries.length}
          />
        </Panel>

        <Panel className="h-fit">
          <PanelHeader title="How a finding is scored" />
          <ul className="divide-y divide-rule">
            {[
              ["Semantic similarity", "How close the internal claim and the public theme are."],
              ["Frequency", "How often the theme is actually said in public."],
              ["Recency", "How recently, on a twelve-month half-life."],
              ["Source diversity", "How many distinct publishers carry it."],
              ["Confidence", "How explicitly the content supported the reading."],
              ["Internal priority", "An entry a person wrote outranks an extracted one."],
            ].map(([label, description]) => (
              <li key={label} className="px-5 py-2.5">
                <p className="text-xs font-medium text-ink">{label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
              </li>
            ))}
          </ul>
          <p className="border-t border-rule px-5 py-3 text-xs leading-relaxed text-ink-muted">
            Every finding carries its components with their values and weights. Open &ldquo;Why&rdquo;
            on any of them to see the numbers the score came from.
          </p>
        </Panel>
      </aside>
    </div>
  );
}
