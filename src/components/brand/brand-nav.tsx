"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { segment: "", label: "Overview" },
  { segment: "sources", label: "Sources" },
  { segment: "memory", label: "Brand memory" },
  { segment: "external", label: "External memory" },
  { segment: "generate", label: "Generate" },
  { segment: "settings", label: "Settings" },
] as const;

export function BrandNav({ brandId }: { brandId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/brands/${brandId}`;

  return (
    <nav className="-mb-px flex gap-6 overflow-x-auto">
      {SECTIONS.map((section) => {
        const href = section.segment ? `${base}/${section.segment}` : base;
        const active = section.segment
          ? pathname.startsWith(href)
          : pathname === base;

        return (
          <Link
            key={section.label}
            href={href}
            className={cn(
              "whitespace-nowrap border-b-2 pb-3 text-sm transition-colors",
              active
                ? "border-signal text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
