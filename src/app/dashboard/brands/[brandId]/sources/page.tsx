import { requireUser } from "@/lib/db/server";
import { listSources } from "@/lib/db/queries";
import { summariseSources } from "@/lib/brand-health";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { UploadForm } from "@/components/sources/upload-form";
import { SourceTable } from "@/components/sources/source-table";

export default async function SourcesPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { supabase } = await requireUser();
  const sources = await listSources(supabase, brandId);
  const breakdown = summariseSources(sources);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <Panel>
        <PanelHeader
          title="Sources"
          description={`${breakdown.total} uploaded · ${breakdown.ready} ready · ${breakdown.failed} failed`}
        />
        <SourceTable sources={sources} />
      </Panel>

      <aside className="space-y-8">
        <Panel className="h-fit">
          <PanelHeader
            title="Add knowledge"
            description="Each file becomes a source: extracted, chunked, embedded and traceable."
          />
          <UploadForm brandId={brandId} />
        </Panel>

        <Panel className="h-fit">
          <PanelHeader title="How conflicts are settled" />
          <ol className="divide-y divide-rule">
            {[
              ["1", "Memory a person edited"],
              ["2", "Newest official source"],
              ["3", "Other sources, by priority"],
              ["4", "AI inference"],
            ].map(([rank, label]) => (
              <li key={rank} className="flex items-center gap-3 px-5 py-2.5">
                <span className="font-mono text-[0.6875rem] text-ink-faint">{rank}</span>
                <span className="text-xs text-ink-muted">{label}</span>
              </li>
            ))}
          </ol>
          <p className="border-t border-rule px-5 py-3 text-xs leading-relaxed text-ink-muted">
            Contradictions are never merged silently. When two sources disagree, the answer says
            which one it used.
          </p>
        </Panel>
      </aside>
    </div>
  );
}
