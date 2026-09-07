"use client";

import { useActionState, useRef, useState } from "react";
import { createExternalFeed } from "@/actions/external";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  CONNECTOR_KIND_LABELS,
  EXTERNAL_CONNECTOR_KINDS,
  EXTERNAL_SYNC_FREQUENCIES,
} from "@/types/external";
import type { ExternalConnectorKind } from "@/types/external";
import type { ActionResult } from "@/actions/result";

const HINTS: Record<ExternalConnectorKind, string> = {
  URL: "A single page, re-read on every sync.",
  SITEMAP: "https://brand.com/sitemap.xml — newest pages first.",
  RSS: "A newsroom or blog feed, RSS or Atom.",
  CRAWL: "A starting page. The crawl stays on the same site and honours robots.txt.",
};

/** Registers a source to watch: sitemap, feed, site or single URL. */
export function FeedForm({ brandId }: { brandId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<ExternalConnectorKind>("SITEMAP");
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await createExternalFeed(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    null,
  );

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={formAction} className="space-y-4 px-5 py-5">
      <input type="hidden" name="brandId" value={brandId} />

      <Field label="Kind">
        <Select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ExternalConnectorKind)}
        >
          {EXTERNAL_CONNECTOR_KINDS.map((option) => (
            <option key={option} value={option}>
              {CONNECTOR_KIND_LABELS[option]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="URL" hint={HINTS[kind]} error={errors?.url}>
        <Input name="url" type="url" required placeholder="https://" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sync" hint="Scheduled runs need CRON_SECRET set.">
          <Select name="frequency" defaultValue="MANUAL">
            {EXTERNAL_SYNC_FREQUENCIES.map((option) => (
              <option key={option} value={option}>
                {option.charAt(0) + option.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Max per sync" hint="Caps the cost of one run.">
          <Select name="maxDocuments" defaultValue="25">
            {[5, 10, 25, 50, 100, 200].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Label" hint="Optional.">
        <Input name="label" maxLength={120} placeholder="Newsroom" />
      </Field>

      {state && !state.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">{state.error}</p>
      ) : null}

      {state?.ok ? (
        <p className="border border-positive bg-surface px-3 py-2 text-xs text-positive">
          Watching. Run a sync to discover content.
        </p>
      ) : null}

      <SubmitButton pendingLabel="Saving…">Watch this source</SubmitButton>
    </form>
  );
}
