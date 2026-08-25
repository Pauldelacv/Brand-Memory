"use client";

import { useActionState, useState } from "react";
import { createMemoryEntry, runMemoryExtraction } from "@/actions/memory";
import type { ExtractionSummary } from "@/actions/memory";
import { EntryForm } from "@/components/memory/entry-form";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/actions/result";

export function ExtractionPanel({ brandId, readySources }: { brandId: string; readySources: number }) {
  const [adding, setAdding] = useState(false);
  const [state, formAction] = useActionState<ActionResult<ExtractionSummary> | null, FormData>(
    runMemoryExtraction,
    null,
  );

  return (
    <div className="space-y-5 px-5 py-5">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="brandId" value={brandId} />
        <p className="text-xs leading-relaxed text-ink-muted">
          Reads the processed documents and proposes structured entries. Entries you have edited are
          never overwritten.
        </p>
        <SubmitButton size="sm" pendingLabel="Reading sources…" disabled={readySources === 0}>
          Run extraction
        </SubmitButton>
        {readySources === 0 ? (
          <p className="text-xs text-ink-faint">Upload and process at least one source first.</p>
        ) : null}
      </form>

      {state && !state.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      ) : null}

      {state?.ok ? (
        <p className="border border-positive bg-surface px-3 py-2 text-xs text-positive">
          {state.data.created} created · {state.data.updated} updated ·{" "}
          {state.data.skippedUserEdited} left untouched because a person edited them.
        </p>
      ) : null}

      <div className="border-t border-rule pt-4">
        {adding ? (
          <EntryForm
            action={createMemoryEntry}
            brandId={brandId}
            submitLabel="Add entry"
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Add an entry by hand
          </Button>
        )}
      </div>
    </div>
  );
}
