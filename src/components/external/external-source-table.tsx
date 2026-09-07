"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteExternalSource, reprocessExternalSource } from "@/actions/external";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/panel";
import { ExternalStatusPill, Tag } from "@/components/ui/status";
import { EXTERNAL_SOURCE_TYPE_LABELS } from "@/types/external";
import type { ExternalSourceListItem } from "@/types/external";
import type { ActionResult } from "@/actions/result";

const POLL_INTERVAL_MS = 5000;

export function ExternalSourceTable({ sources }: { sources: ExternalSourceListItem[] }) {
  const router = useRouter();
  const pending = sources.some(
    (source) =>
      source.status === "DISCOVERED" || source.status === "FETCHING" || source.status === "PROCESSING",
  );

  // Reading and analysing runs after the response; refresh while anything is
  // still in flight, exactly as the internal sources table does.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  if (sources.length === 0) {
    return (
      <EmptyState
        title="No public content yet"
        description="Add a URL, or watch the brand's sitemap or newsroom feed. Everything the brand has published becomes part of the external memory."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            {["Content", "Type", "Publisher", "Published", "Status", "Themes", ""].map((heading) => (
              <th key={heading} className="label px-5 py-2.5 font-normal">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceRow({ source }: { source: ExternalSourceListItem }) {
  const [expanded, setExpanded] = useState(false);
  const [reprocessState, reprocessAction] = useActionState<ActionResult | null, FormData>(
    reprocessExternalSource,
    null,
  );
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(
    deleteExternalSource,
    null,
  );

  const error =
    (reprocessState && !reprocessState.ok && reprocessState.error) ||
    (deleteState && !deleteState.ok && deleteState.error) ||
    null;

  return (
    <>
      <tr className="align-top">
        <td className="px-5 py-3">
          <p className="max-w-md font-medium text-ink">{source.title}</p>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block max-w-md truncate font-mono text-[0.6875rem] text-ink-faint underline underline-offset-4 hover:text-signal"
          >
            {source.url}
          </a>
          {source.status === "FAILED" && source.extractionError ? (
            <p className="mt-1.5 max-w-md text-xs text-critical">{source.extractionError}</p>
          ) : null}
          {source.status === "DUPLICATE" && source.extractionError ? (
            <p className="mt-1.5 max-w-md text-xs text-ink-muted">{source.extractionError}</p>
          ) : null}
        </td>

        <td className="px-5 py-3">
          <span className="font-mono text-[0.6875rem] text-ink-muted">
            {EXTERNAL_SOURCE_TYPE_LABELS[source.sourceType]}
          </span>
          <span className="mt-1 block font-mono text-[0.6875rem] text-ink-faint">
            {source.mediaClass.toLowerCase()}
          </span>
        </td>

        <td className="px-5 py-3">
          <span className="text-xs text-ink-muted">{source.publisher ?? "—"}</span>
        </td>

        <td className="px-5 py-3">
          <span className="font-mono text-[0.6875rem] text-ink-muted">
            {source.publishedAt ? source.publishedAt.slice(0, 10) : "—"}
          </span>
        </td>

        <td className="px-5 py-3">
          <ExternalStatusPill status={source.status} />
        </td>

        <td className="px-5 py-3">
          <div className="flex max-w-[220px] flex-wrap gap-1">
            {source.themes.slice(0, 3).map((theme) => (
              <Tag key={theme}>{theme}</Tag>
            ))}
            {source.themes.length > 3 ? (
              <span className="font-mono text-[0.6875rem] text-ink-faint">
                +{source.themes.length - 3}
              </span>
            ) : null}
            {source.themes.length === 0 ? (
              <span className="font-mono text-[0.6875rem] text-ink-faint">—</span>
            ) : null}
          </div>
        </td>

        <td className="px-5 py-3 text-right">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Close" : "Manage"}
          </Button>
        </td>
      </tr>

      {expanded ? (
        <tr>
          <td colSpan={7} className="bg-paper px-5 py-4">
            {source.summary ? (
              <p className="mb-3 max-w-3xl text-xs leading-relaxed text-ink-muted">{source.summary}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <form action={reprocessAction}>
                <input type="hidden" name="sourceId" value={source.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Re-read
                </Button>
              </form>

              <form action={deleteAction}>
                <input type="hidden" name="sourceId" value={source.id} />
                <Button type="submit" variant="danger" size="sm">
                  Remove
                </Button>
              </form>

              <span className="font-mono text-[0.6875rem] text-ink-faint">
                {source.chunkCount} passages · {source.entryCount} themes · discovered{" "}
                {new Date(source.discoveredAt).toLocaleDateString()}
              </span>
            </div>

            {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
            {reprocessState?.ok ? <p className="mt-2 text-xs text-positive">Re-read.</p> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
