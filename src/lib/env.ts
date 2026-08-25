import "server-only";

/**
 * Server-side environment access. Secrets are read through these helpers only,
 * never re-exported to the client bundle.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicApiKey: () => optional("ANTHROPIC_API_KEY"),
  openaiApiKey: () => optional("OPENAI_API_KEY"),
  textProvider: () => optional("AI_TEXT_PROVIDER") ?? "anthropic",
  embeddingProvider: () => optional("AI_EMBEDDING_PROVIDER") ?? "openai",
  textModel: () => optional("AI_TEXT_MODEL"),
  embeddingModel: () => optional("AI_EMBEDDING_MODEL"),
};
