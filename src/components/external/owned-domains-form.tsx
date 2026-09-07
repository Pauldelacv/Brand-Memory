"use client";

import { useActionState } from "react";
import { updateOwnedDomains } from "@/actions/external";
import { Field, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/actions/result";

/**
 * The brand's own domains. They decide what counts as owned media versus press
 * coverage, and they are the allowlist the site crawl stays inside.
 */
export function OwnedDomainsForm({
  brandId,
  ownedDomains,
}: {
  brandId: string;
  ownedDomains: string[];
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    updateOwnedDomains,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="brandId" value={brandId} />

      <Field
        label="Owned domains"
        hint="One per line. Content on these reads as the brand speaking; everything else reads as coverage."
      >
        <Textarea
          name="ownedDomains"
          rows={3}
          defaultValue={ownedDomains.join("\n")}
          placeholder="brand.com&#10;newsroom.brand.com"
        />
      </Field>

      {state && !state.ok ? (
        <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">{state.error}</p>
      ) : null}
      {state?.ok ? <p className="text-xs text-positive">Saved.</p> : null}

      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
        Save domains
      </SubmitButton>
    </form>
  );
}
