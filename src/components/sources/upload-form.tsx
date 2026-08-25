"use client";

import { useActionState, useRef } from "react";
import { uploadSource } from "@/actions/sources";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ACCEPTED_MIME_TYPES } from "@/lib/ingestion/media-types";
import type { ActionResult } from "@/actions/result";

export function UploadForm({ brandId }: { brandId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await uploadSource(prev, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    null,
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-5 px-5 py-5">
      <input type="hidden" name="brandId" value={brandId} />

      <Field label="File" hint="PDF, text, markdown, CSV or image. Up to 25 MB.">
        <Input
          name="file"
          type="file"
          required
          accept={ACCEPTED_MIME_TYPES.join(",")}
          className="h-auto py-2 file:mr-3 file:border file:border-rule file:bg-paper file:px-2 file:py-1 file:text-xs file:text-ink"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Source date" hint="Used to prefer newer sources.">
          <Input name="sourceDate" type="date" />
        </Field>

        <Field label="Priority" hint="Higher wins when sources disagree.">
          <Select name="priority" defaultValue="0">
            {Array.from({ length: 11 }, (_, index) => (
              <option key={index} value={index}>
                {index}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <label className="flex items-start gap-2.5 text-xs text-ink-muted">
        <input type="checkbox" name="authoritative" className="mt-0.5" />
        <span>
          <span className="font-medium text-ink">Official source.</span> Outranks unofficial
          material during conflict resolution.
        </span>
      </label>

      {state && !state.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      ) : null}

      {state?.ok ? (
        <p className="border border-positive bg-surface px-3 py-2 text-xs text-positive">
          Uploaded. Processing runs in the background — the status updates on its own.
        </p>
      ) : null}

      <SubmitButton pendingLabel="Uploading…">Upload source</SubmitButton>
    </form>
  );
}
