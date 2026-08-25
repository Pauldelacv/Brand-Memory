"use client";

import { useActionState } from "react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/actions/result";
import type { Brand } from "@/types/domain";

type BrandAction = (prev: unknown, formData: FormData) => Promise<ActionResult>;

export function BrandForm({
  action,
  brand,
  submitLabel,
}: {
  action: BrandAction;
  brand?: Brand;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-6">
      {brand ? <input type="hidden" name="brandId" value={brand.id} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Brand name" error={errors?.name}>
          <Input name="name" required maxLength={120} defaultValue={brand?.name} placeholder="Northbound" />
        </Field>

        <Field label="Industry" error={errors?.industry}>
          <Input name="industry" maxLength={120} defaultValue={brand?.industry} placeholder="Mobility" />
        </Field>
      </div>

      <Field
        label="Short description"
        hint="One or two sentences. This is part of every generation prompt."
        error={errors?.description}
      >
        <Textarea name="description" maxLength={2000} defaultValue={brand?.description} rows={3} />
      </Field>

      <Field label="Website" hint="Optional." error={errors?.website}>
        <Input name="website" type="url" defaultValue={brand?.website ?? ""} placeholder="https://" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Target audience" hint="Optional." error={errors?.audience}>
          <Textarea name="audience" maxLength={2000} defaultValue={brand?.audience ?? ""} rows={3} />
        </Field>

        <Field label="Positioning" hint="Optional." error={errors?.positioning}>
          <Textarea name="positioning" maxLength={2000} defaultValue={brand?.positioning ?? ""} rows={3} />
        </Field>
      </div>

      {state && !state.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      ) : null}

      {state?.ok ? (
        <p className="border border-positive bg-surface px-3 py-2 text-xs text-positive">Saved.</p>
      ) : null}

      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
