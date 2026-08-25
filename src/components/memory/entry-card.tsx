"use client";

import { useActionState, useState } from "react";
import { deleteMemoryEntry, updateMemoryEntry } from "@/actions/memory";
import { EntryForm } from "@/components/memory/entry-form";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/status";
import { MEMORY_CATEGORY_LABELS } from "@/types/domain";
import type { MemoryEntry } from "@/types/domain";
import type { ActionResult } from "@/actions/result";

export function EntryCard({ entry }: { entry: MemoryEntry }) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(
    deleteMemoryEntry,
    null,
  );

  return (
    <article className="px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{MEMORY_CATEGORY_LABELS[entry.category]}</Tag>
          {entry.origin === "USER_EDITED" ? (
            <Tag className="border-signal text-signal">Edited by a person</Tag>
          ) : (
            <Tag>AI extracted · {Math.round(entry.confidence * 100)}% confidence</Tag>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing((value) => !value)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
          <form action={deleteAction}>
            <input type="hidden" name="entryId" value={entry.id} />
            <Button type="submit" variant="ghost" size="sm" className="text-critical">
              Delete
            </Button>
          </form>
        </div>
      </div>

      {editing ? (
        <div className="mt-4">
          <EntryForm
            action={updateMemoryEntry}
            entry={entry}
            submitLabel="Save entry"
            onDone={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          <h3 className="mt-3 text-sm font-semibold text-ink">{entry.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{entry.content}</p>
        </>
      )}

      {deleteState && !deleteState.ok ? (
        <p className="mt-3 text-xs text-critical">{deleteState.error}</p>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3">
        <span className="label">
          Updated {new Date(entry.updatedAt).toLocaleDateString()}
        </span>

        {entry.sourceReferences.length > 0 ? (
          <details className="w-full">
            <summary className="cursor-pointer text-xs text-signal underline underline-offset-4">
              {entry.sourceReferences.length} source
              {entry.sourceReferences.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-2">
              {entry.sourceReferences.map((reference, index) => (
                <li key={`${reference.sourceId}-${index}`} className="border-l-2 border-rule pl-3">
                  <p className="font-mono text-[0.6875rem] text-ink-faint">{reference.sourceName}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {reference.excerpt}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span className="text-xs text-ink-faint">No source attached.</span>
        )}
      </footer>
    </article>
  );
}
