"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/db/server";
import { credentialsSchema, fieldErrors } from "@/lib/validation";
import { failure } from "@/actions/result";
import type { ActionResult } from "@/actions/result";

export async function signIn(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return failure("Check the fields below.", fieldErrors(parsed.error));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return failure("Those credentials did not work.");

  redirect("/dashboard");
}

export async function signUp(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return failure("Check the fields below.", fieldErrors(parsed.error));
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) return failure(error.message);

  // Projects with email confirmation on return a user with no session.
  if (!data.session) {
    return failure("Check your inbox to confirm your address, then sign in.");
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
