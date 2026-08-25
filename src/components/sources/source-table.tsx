"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSource, reprocessSource, updateSourceTrust } from "@/actions/sources";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { StatusPill, Tag } from "@/components/ui/status";
import { formatBytes } from "@/lib/storage";
import { EmptyState } from "@/components/ui/panel";
import type { ActionResult } from "@/actions/result";
import type { BrandSource } from "@/types/domain";

const POLL_INTERVAL_MS = 4000;

export function SourceTable({ sources }: { sources: BrandSource[] }) {
  const router = useRouter();
  const pending = sources.some(
    (source) => source.status === "PROCESSING" || source.status === "UPLOADED",
  );

  // Processing is asynchronous; refresh while anything is still in flight.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  if (sources.length === 0) {
    return (
      <EmptyState
        title="No sources uploaded"
        description="Upload the brand guidelines first — they usually carry identity, voice and visual language in one document."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            {["Source", "Type", "Status", "Date", "Priority", ""].map((heading) => (
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

function SourceRow({ source }: { source: BrandSource }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="align-top">
        <td className="px-5 py-3">
          <p className="font-medium text-ink">{source.filename}</p>
          <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-faint">
            {formatBytes(source.byteSize)} · {source.chunkCount} passages
          </p>
          {source.status === "FAILED" && source.error ? (
            <p className="mt-1.5 max-w-md text-xs text-critical">{source.error}</p>
          ) : null}
        </td>
        <td className="px-5 py-3">
          <span className="font-mono text-[0.6875rem] text-ink-muted">
            {source.mimeType.split("/")[1] ?? source.mimeType}
          </span>
        </td>
        <td className="px-5 py-3">
          <StatusPill status={source.status} />
        </td>
        <td className="px-5 py-3">
          <span className="font-mono text-[0.6875rem] text-ink-muted">
            {source.sourceDate ?? new Date(source.createdAt).toLocaleDateString()}
          </span>
        </td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm text-ink">{source.priority}</span>
            {source.authoritative ? <Tag className="border-signal text-signal">Official</Tag> : null}
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
          <td colSpan={6} className="bg-paper px-5 py-4">
            <SourceControls source={source} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SourceControls({ source }: { source: BrandSource }) {
  const [trustState, trustAction] = useActionState<ActionResult | null, FormData>(
    updateSourceTrust,
    null,
  );
  const [processState, processAction] = useActionState<ActionResult | null, FormData>(
    reprocessSource,
    null,
  );
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(
    deleteSource,
    null,
  );

  const error =
    (trustState && !trustState.ok && trustState.error) ||
    (processState && !processState.ok && processState.error) ||
    (deleteState && !deleteState.ok && deleteState.error) ||
    null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <form action={trustAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="sourceId" value={source.id} />

          <label className="block space-y-1.5">
            <span className="label block">Priority</span>
            <Select name="priority" defaultValue={String(source.priority)} className="w-20">
              {Array.from({ length: 11 }, (_, index) => (
                <option key={index} value={index}>
                  {index}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex h-10 items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" name="authoritative" defaultChecked={source.authoritative} />
            Official source
          </label>

          <Button type="submit" variant="secondary" size="sm">
            Save trust settings
          </Button>
        </form>

        <form action={processAction}>
          <input type="hidden" name="sourceId" value={source.id} />
          <Button type="submit" variant="secondary" size="sm">
            Re-process
          </Button>
        </form>

        <form action={deleteAction}>
          <input type="hidden" name="sourceId" value={source.id} />
          <Button type="submit" variant="danger" size="sm">
            Delete source
          </Button>
        </form>
      </div>

      {error ? <p className="text-xs text-critical">{error}</p> : null}
      {processState?.ok ? <p className="text-xs text-positive">Re-processed.</p> : null}
      {trustState?.ok ? <p className="text-xs text-positive">Saved.</p> : null}
    </div>
  );
}
