import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import { listBrands } from "@/lib/db/queries";
import { buttonVariants } from "@/components/ui/button";
import { Panel, PanelHeader, EmptyState } from "@/components/ui/panel";
import { Tag } from "@/components/ui/status";

export const metadata = { title: "Brands — Brand Memory" };

interface ActivityRow {
  id: string;
  brand_id: string;
  content: string;
  mode: string;
  created_at: string;
  brands: { name: string } | null;
}

export default async function DashboardPage() {
  const { supabase } = await requireUser();
  const brands = await listBrands(supabase);

  const { data } = await supabase
    .from("messages")
    .select("id, brand_id, content, mode, created_at, brands(name)")
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(6);

  const activity = (data ?? []) as unknown as ActivityRow[];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-6 border-b border-rule pb-6">
        <div>
          <p className="label">Workspace</p>
          <h1 className="mt-1 font-serif text-3xl text-ink">Brands</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-muted">
            Each brand keeps its own sources, structured memory and generation history.
          </p>
        </div>
        <Link href="/dashboard/brands/new" className={buttonVariants({ variant: "primary" })}>
          New brand
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <Panel>
          <PanelHeader title="All brands" description={`${brands.length} in this workspace`} />

          {brands.length === 0 ? (
            <EmptyState
              title="No brands yet"
              description="Create a brand, upload its guidelines and campaigns, and the memory starts building itself."
              action={
                <Link href="/dashboard/brands/new" className="text-sm text-signal underline underline-offset-4">
                  Create the first brand
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-rule">
              {brands.map((brand) => (
                <li key={brand.id}>
                  <Link
                    href={`/dashboard/brands/${brand.id}`}
                    className="flex items-center justify-between gap-6 px-5 py-4 hover:bg-paper"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-serif text-lg text-ink">{brand.name}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {brand.description || "No description yet."}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {brand.industry ? <Tag>{brand.industry}</Tag> : null}
                      <span className="font-mono text-[0.6875rem] text-ink-faint">
                        {new Date(brand.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="h-fit">
          <PanelHeader title="Recent generations" description="Across every brand" />

          {activity.length === 0 ? (
            <EmptyState
              title="Nothing generated yet"
              description="Answers you generate will be listed here with the brand they came from."
            />
          ) : (
            <ul className="divide-y divide-rule">
              {activity.map((row) => (
                <li key={row.id} className="px-5 py-4">
                  <Link href={`/dashboard/brands/${row.brand_id}/generate`} className="block group">
                    <div className="flex items-center gap-2">
                      <Tag>{row.mode}</Tag>
                      <span className="truncate text-xs text-ink-muted">
                        {row.brands?.name ?? "Brand"}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink group-hover:text-signal">
                      {row.content}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
