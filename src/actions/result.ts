import { AIProviderError } from "@/lib/ai/types";
import { DatabaseError, NotFoundError } from "@/lib/db/queries";
import { UnauthenticatedError } from "@/lib/db/server";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function failure(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, ...(fieldErrors ? { fieldErrors } : {}) };
}

/** Turns a thrown error into a message a user can act on. Nothing is swallowed. */
export function describeError(error: unknown): string {
  if (error instanceof UnauthenticatedError) return "Your session expired. Sign in again.";
  if (error instanceof NotFoundError) return error.message;
  if (error instanceof AIProviderError) return error.message;
  if (error instanceof DatabaseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
