import "server-only";

import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses row level security, so it is only used by the
 * ingestion pipeline after ownership has already been verified by the caller.
 * Never expose this client, or anything derived from it, to the browser.
 */
export function createAdminSupabase() {
  return createClient(serverEnv.supabaseUrl(), serverEnv.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
