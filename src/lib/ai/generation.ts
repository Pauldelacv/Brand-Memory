import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, GenerationMode, RetrievalCitation } from "@/types/domain";
import { getAIProvider } from "@/lib/ai";
import { retrieveBrandContext } from "@/lib/ai/retrieval";
import { generationSystemPrompt, generationUserPrompt } from "@/lib/ai/prompts";
import type { GenerationMessage } from "@/lib/ai/types";

export interface BrandGenerationResult {
  text: string;
  model: string;
  citations: RetrievalCitation[];
  /** Surfaced in the UI so a user can see the sources disagreed. */
  conflicts: string[];
  retrievedCount: number;
}

/**
 * The full generation flow: understand the request, retrieve, assemble a
 * selective context, generate, attach attribution.
 */
export async function generateForBrand(
  supabase: SupabaseClient,
  brand: Brand,
  prompt: string,
  mode: GenerationMode,
  history: GenerationMessage[] = [],
): Promise<BrandGenerationResult> {
  const context = await retrieveBrandContext(supabase, brand.id, prompt);
  const provider = getAIProvider();

  const output = await provider.generateText({
    system: generationSystemPrompt(brand, mode),
    // Keep the tail of the conversation only; the brand context does the heavy lifting.
    messages: [
      ...history.slice(-6),
      { role: "user", content: generationUserPrompt(context.text, prompt) },
    ],
    maxTokens: mode === "ASK" ? 1200 : 2400,
    temperature: mode === "ASK" ? 0.2 : 0.6,
  });

  return {
    text: output.text,
    model: output.model,
    citations: context.citations,
    conflicts: context.conflicts.map(
      (conflict) => `${conflict.topic} — ${conflict.reason}. Superseded: ${conflict.supersededSummaries.join(" | ")}`,
    ),
    retrievedCount: context.candidates.length,
  };
}
