import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/db/server";
import { NotFoundError, getOwnedBrand } from "@/lib/db/queries";
import { BrandNav } from "@/components/brand/brand-nav";
import { Tag } from "@/components/ui/status";

export default async function BrandLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { supabase } = await requireUser();

  // A brand that belongs to someone else is indistinguishable from one that
  // does not exist — changing the id in the URL reveals nothing.
  let brand;
  try {
    brand = await getOwnedBrand(supabase, brandId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-rule">
        <Link href="/dashboard" className="label hover:text-ink">
          ← Brands
        </Link>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4 pb-5">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl text-ink">{brand.name}</h1>
            {brand.description ? (
              <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{brand.description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {brand.industry ? <Tag>{brand.industry}</Tag> : null}
            {brand.website ? (
              <a
                href={brand.website}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Website
              </a>
            ) : null}
          </div>
        </div>

        <BrandNav brandId={brand.id} />
      </header>

      {children}
    </div>
  );
}
