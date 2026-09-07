import { requireUser } from "@/lib/db/server";
import { getOwnedBrand } from "@/lib/db/queries";
import { listExternalFeeds, listExternalSources } from "@/lib/external/queries";
import { AddUrlForm } from "@/components/external/add-url-form";
import { ExternalSourceTable } from "@/components/external/external-source-table";
import { FeedForm } from "@/components/external/feed-form";
import { FeedList } from "@/components/external/feed-list";
import { OwnedDomainsForm } from "@/components/external/owned-domains-form";
import { Panel, PanelHeader } from "@/components/ui/panel";

export default async function ExternalSourcesPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { supabase } = await requireUser();

  const [brand, sources, feeds] = await Promise.all([
    getOwnedBrand(supabase, brandId),
    listExternalSources(supabase, brandId),
    listExternalFeeds(supabase, brandId),
  ]);

  const ready = sources.filter((source) => source.status === "READY").length;
  const duplicates = sources.filter((source) => source.status === "DUPLICATE").length;
  const failed = sources.filter((source) => source.status === "FAILED").length;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-8">
        <Panel>
          <PanelHeader
            title="Public content"
            description={`${sources.length} found · ${ready} read · ${duplicates} duplicates · ${failed} failed`}
          />
          <ExternalSourceTable sources={sources} />
        </Panel>

        <Panel>
          <PanelHeader
            title="Watched sources"
            description="Discovery skips URLs already read, so a sync only pays for what is new."
          />
          <FeedList brandId={brand.id} feeds={feeds} />
        </Panel>
      </div>

      <aside className="space-y-8">
        <Panel className="h-fit">
          <PanelHeader title="Add one content" description="A single article, release or page." />
          <AddUrlForm brandId={brand.id} />
        </Panel>

        <Panel className="h-fit">
          <PanelHeader title="Watch a source" description="Sitemap, feed, site crawl or a page." />
          <FeedForm brandId={brand.id} />
        </Panel>

        <Panel className="h-fit">
          <PanelHeader title="Owned domains" description="Separates the brand's own voice from coverage." />
          <div className="px-5 py-5">
            <OwnedDomainsForm brandId={brand.id} ownedDomains={brand.ownedDomains} />
          </div>
        </Panel>

        <Panel className="h-fit">
          <PanelHeader title="How duplicates are handled" />
          <ol className="divide-y divide-rule">
            {[
              ["Identical", "The same page, or the same text. Set aside."],
              ["Near duplicate", "A reprint by the same publisher. Set aside."],
              ["Syndicated", "An outlet running the brand's release. Kept — that is pick-up."],
              ["Distinct", "Genuinely different content. Kept."],
            ].map(([label, description]) => (
              <li key={label} className="px-5 py-2.5">
                <p className="text-xs font-medium text-ink">{label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
              </li>
            ))}
          </ol>
        </Panel>
      </aside>
    </div>
  );
}
