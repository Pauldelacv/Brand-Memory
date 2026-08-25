"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from "@/types/domain";
import type { MemoryCategory, MemoryEntry } from "@/types/domain";
import type { ActionResult } from "@/actions/result";

type EntryAction = (prev: unknown, formData: FormData) => Promise<ActionResult>;

export function EntryForm({
  action,
  brandId,
  entry,
  defaultCategory,
  submitLabel,
  onDone,
}: {
  action: EntryAction;
  brandId?: string;
  entry?: MemoryEntry;
  defaultCategory?: MemoryCategory;
  submitLabel: string;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      if (result.ok) onDone?.();
      return result;
    },
    null,
  );

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      {brandId ? <input type="hidden" name="brandId" value={brandId} /> : null}
      {entry ? <input type="hidden" name="entryId" value={entry.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <Field label="Category" error={errors?.category}>
          <Select name="category" defaultValue={entry?.category ?? defaultCategory ?? "IDENTITY"}>
            {MEMORY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {MEMORY_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Title" hint="The claim slot, e.g. “Tone of voice”." error={errors?.title}>
          <Input name="title" required maxLength={160} defaultValue={entry?.title} />
        </Field>
      </div>

      <Field label="Content" error={errors?.content}>
        <Textarea name="content" required rows={4} maxLength={8000} defaultValue={entry?.content} />
      </Field>

      {state && !state.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
        <p className="text-xs text-ink-faint">Saving marks this entry as edited by a person.</p>
      </div>
    </form>
  );
}
