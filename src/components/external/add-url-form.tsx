"use client";

import { useActionState, useRef } from "react";
import { addExternalUrl } from "@/actions/external";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EXTERNAL_SOURCE_TYPES, EXTERNAL_SOURCE_TYPE_LABELS } from "@/types/external";
import type { ActionResult } from "@/actions/result";

/** One-off import: a press article, an interview, a page someone sent over. */
export function AddUrlForm({ brandId }: { brandId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await addExternalUrl(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    null,
  );

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={formAction} className="space-y-4 px-5 py-5">
      <input type="hidden" name="brandId" value={brandId} />

      <Field label="URL" hint="An article, a release, an interview, a page." error={errors?.url}>
        <Input name="url" type="url" required placeholder="https://" />
      </Field>

      <Field label="Type" hint="Corrected automatically once the page is read.">
        <Select name="sourceType" defaultValue="WEB_PAGE">
          {EXTERNAL_SOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {EXTERNAL_SOURCE_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      {state && !state.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">{state.error}</p>
      ) : null}

      {state?.ok ? (
        <p className="border border-positive bg-surface px-3 py-2 text-xs text-positive">
          Added. The page is being read in the background — the table updates on its own.
        </p>
      ) : null}

      <SubmitButton pendingLabel="Adding…">Add content</SubmitButton>
    </form>
  );
}
