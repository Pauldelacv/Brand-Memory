"use client";

import { useState } from "react";
import { RelevanceBar, Tag } from "@/components/ui/status";
import type { RetrievalCitation } from "@/types/domain";

/**
 * Source attribution. Every generated answer carries the retrieved context that
 * produced it, and each entry can be opened to read the exact excerpt used.
 */
export function CitationList({ citations }: { citations: RetrievalCitation[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (citations.length === 0) {
    return (
      <p className="text-xs text-ink-faint">
        No brand knowledge matched this request — the answer is not grounded in any source.
      </p>
    );
  }

  return (
    <div>
      <p className="label">Sources used</p>
      <ul className="mt-2 space-y-1.5">
        {citations.map((citation, index) => {
          const open = openId === citation.refId;
          return (
            <li key={citation.refId} className="border border-rule bg-surface">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : citation.refId)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper"
              >
                <span className="font-mono text-[0.6875rem] text-ink-faint">[{index + 1}]</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink">{citation.label}</span>
                <Tag>{citation.kind === "MEMORY" ? "Memory" : "Document"}</Tag>
                <RelevanceBar value={citation.similarity} />
              </button>

              {open ? (
                <div className="border-t border-rule px-3 py-2.5">
                  {citation.sourceName ? (
                    <p className="label">From {citation.sourceName}</p>
                  ) : null}
                  <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                    {citation.excerpt}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
