import { ExternalNav } from "@/components/external/external-nav";

export default async function ExternalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">External memory</p>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            What the brand has actually said in public, and how that compares with what it says it is.
          </p>
        </div>
        <ExternalNav brandId={brandId} />
      </div>

      {children}
    </div>
  );
}
