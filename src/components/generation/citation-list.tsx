"use client";

import { useState } from "react";
import { RelevanceBar, Tag } from "@/components/ui/status";
import { RETRIEVAL_KIND_LABELS } from "@/types/domain";
import type { RetrievalCitation } from "@/types/domain";

/**
 * Source attribution. Every generated answer carries the retrieved context that
 * produced it, and each entry can be opened to read the exact excerpt used.
 *
 * Internal and public sources are labelled apart on purpose: an answer that
 * leans on something the brand published in 2022 is a different claim from one
 * that leans on the current guidelines, and the reader has to be able to tell.
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
                <Tag
                  className={
                    citation.kind === "EXTERNAL_MEMORY" || citation.kind === "EXTERNAL_DOCUMENT"
                      ? "border-signal text-signal"
                      : undefined
                  }
                >
                  {RETRIEVAL_KIND_LABELS[citation.kind]}
                </Tag>
                <RelevanceBar value={citation.similarity} />
              </button>

              {open ? (
                <div className="border-t border-rule px-3 py-2.5">
                  {citation.sourceName || citation.publishedAt ? (
                    <p className="label">
                      {citation.sourceName ? `From ${citation.sourceName}` : "Published"}
                      {citation.publishedAt ? ` · ${citation.publishedAt.slice(0, 10)}` : ""}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                    {citation.excerpt}
                  </p>
                  {citation.url ? (
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate font-mono text-[0.6875rem] text-signal underline underline-offset-4"
                    >
                      {citation.url}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
