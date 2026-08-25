import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden flex-col justify-between border-r border-rule bg-surface px-12 py-14 lg:flex">
        <Link href="/" className="font-mono text-xs tracking-[0.18em] uppercase text-ink">
          Brand Memory
        </Link>

        <div className="max-w-md">
          <h1 className="font-serif text-4xl leading-[1.1] text-ink">
            The AI should understand the brand before creating for the brand.
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-ink-muted">
            Upload guidelines, decks, campaigns and tone of voice. Everything is extracted,
            structured and made queryable, so every generated answer is grounded in what the brand
            has already decided.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 border-t border-rule pt-6">
          {[
            ["Ingestion", "PDF, text, images"],
            ["Memory", "Structured + vector"],
            ["Attribution", "Every answer sourced"],
          ].map(([term, detail]) => (
            <div key={term}>
              <dt className="label">{term}</dt>
              <dd className="mt-1 text-xs text-ink-muted">{detail}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <main className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
