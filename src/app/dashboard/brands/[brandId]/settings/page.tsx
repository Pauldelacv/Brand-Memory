import { requireUser } from "@/lib/db/server";
import { getOwnedBrand } from "@/lib/db/queries";
import { updateBrand } from "@/actions/brands";
import { BrandForm } from "@/components/brand/brand-form";
import { DeleteBrand } from "@/components/brand/delete-brand";
import { Panel, PanelHeader } from "@/components/ui/panel";

export default async function BrandSettingsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { supabase } = await requireUser();
  const brand = await getOwnedBrand(supabase, brandId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Panel>
        <PanelHeader
          title="Brand details"
          description="This profile is included in every generation prompt, alongside the retrieved memory."
        />
        <div className="px-5 py-5">
          <BrandForm action={updateBrand} brand={brand} submitLabel="Save changes" />
        </div>
      </Panel>

      <Panel className="border-critical">
        <PanelHeader
          title="Delete this brand"
          description="Removes the brand, its sources, indexed passages, memory and conversations. This cannot be undone."
        />
        <div className="px-5 py-5">
          <DeleteBrand brandId={brand.id} brandName={brand.name} />
        </div>
      </Panel>
    </div>
  );
}
