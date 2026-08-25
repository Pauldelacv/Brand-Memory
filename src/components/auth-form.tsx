"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/actions/result";

type AuthAction = (prev: unknown, formData: FormData) => Promise<ActionResult>;

export function AuthForm({
  action,
  mode,
}: {
  action: AuthAction;
  mode: "signin" | "signup";
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div>
      <h1 className="font-serif text-3xl text-ink">
        {mode === "signin" ? "Sign in" : "Create an account"}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        {mode === "signin"
          ? "Continue to your brand workspaces."
          : "Start with one brand. Add its knowledge, then generate from it."}
      </p>

      <form action={formAction} className="mt-8 space-y-5">
        <Field label="Email" error={errors?.email}>
          <Input name="email" type="email" autoComplete="email" required placeholder="you@studio.com" />
        </Field>

        <Field
          label="Password"
          hint={mode === "signup" ? "At least 8 characters." : undefined}
          error={errors?.password}
        >
          <Input
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={8}
          />
        </Field>

        {state && !state.ok ? (
          <p className="border border-critical bg-surface px-3 py-2 text-xs text-critical">
            {state.error}
          </p>
        ) : null}

        <SubmitButton className="w-full" pendingLabel={mode === "signin" ? "Signing in…" : "Creating…"}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </SubmitButton>
      </form>

      <p className="mt-6 text-xs text-ink-muted">
        {mode === "signin" ? (
          <>
            No account yet?{" "}
            <Link href="/signup" className="text-ink underline underline-offset-4">
              Create one
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-ink underline underline-offset-4">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
