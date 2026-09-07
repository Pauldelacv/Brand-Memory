"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { segment: "", label: "Overview" },
  { segment: "sources", label: "Sources" },
  { segment: "messages", label: "Messages" },
  { segment: "timeline", label: "Timeline" },
  { segment: "consistency", label: "Consistency" },
] as const;

/** Second-level navigation inside External memory. */
export function ExternalNav({ brandId }: { brandId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/brands/${brandId}/external`;

  return (
    <nav className="flex gap-1 overflow-x-auto border border-rule bg-surface p-1">
      {SECTIONS.map((section) => {
        const href = section.segment ? `${base}/${section.segment}` : base;
        const active = section.segment ? pathname.startsWith(href) : pathname === base;

        return (
          <Link
            key={section.label}
            href={href}
            className={cn(
              "whitespace-nowrap px-3 py-1.5 text-xs transition-colors",
              active ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper hover:text-ink",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
