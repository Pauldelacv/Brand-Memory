import Link from "next/link";
import { BrandForm } from "@/components/brand/brand-form";
import { createBrand } from "@/actions/brands";
import { Panel } from "@/components/ui/panel";

export const metadata = { title: "New brand — Brand Memory" };

export default function NewBrandPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="border-b border-rule pb-6">
        <Link href="/dashboard" className="label hover:text-ink">
          ← Brands
        </Link>
        <h1 className="mt-3 font-serif text-3xl text-ink">Create a brand</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Only the name is required. Everything else can be filled in later, or extracted from the
          sources you upload.
        </p>
      </div>

      <Panel className="p-6">
        <BrandForm action={createBrand} submitLabel="Create brand" />
      </Panel>
    </div>
  );
}
