"use client";

import { useActionState, useState } from "react";
import { deleteBrand } from "@/actions/brands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/actions/result";

export function DeleteBrand({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, formAction] = useActionState<ActionResult | null, FormData>(deleteBrand, null);

  if (!confirming) {
    return (
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Delete brand
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="brandId" value={brandId} />
      <p className="text-xs text-ink-muted">
        Type <span className="font-mono text-ink">{brandName}</span> to confirm.
      </p>
      <Input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        aria-label="Confirm brand name"
      />
      {state && !state.ok ? <p className="text-xs text-critical">{state.error}</p> : null}
      <div className="flex items-center gap-2">
        <SubmitButton variant="danger" pendingLabel="Deleting…" disabled={typed !== brandName}>
          Delete permanently
        </SubmitButton>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
