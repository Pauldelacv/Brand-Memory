import "server-only";

import { serverEnv } from "@/lib/env";
import { assertEmbedding } from "@/lib/ai/embeddings";
import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createLocalProvider } from "@/lib/ai/providers/local";
import { createOpenAIProvider } from "@/lib/ai/providers/openai";
import { AIProviderError } from "@/lib/ai/types";
import type {
  AIProvider,
  GenerationInput,
  GenerationOutput,
  ImageTranscriptionInput,
} from "@/lib/ai/types";

/**
 * Text and embeddings can come from different vendors (Anthropic has no
 * embeddings endpoint), so the app resolves one provider for each capability
 * and presents them behind a single AIProvider.
 */

function resolveTextProvider(): AIProvider {
  const choice = serverEnv.textProvider();

  if (choice === "openai") {
    const key = serverEnv.openaiApiKey();
    if (!key) throw new AIProviderError("OPENAI_API_KEY is not set.", "openai");
    return createOpenAIProvider(key, { textModel: serverEnv.textModel() });
  }

  if (choice === "anthropic") {
    const key = serverEnv.anthropicApiKey();
    if (!key) throw new AIProviderError("ANTHROPIC_API_KEY is not set.", "anthropic");
    return createAnthropicProvider(key, serverEnv.textModel());
  }

  throw new AIProviderError(`Unknown AI_TEXT_PROVIDER "${choice}".`, choice);
}

function resolveEmbeddingProvider(): AIProvider {
  const choice = serverEnv.embeddingProvider();

  if (choice === "local") return createLocalProvider();

  if (choice === "openai") {
    const key = serverEnv.openaiApiKey();
    if (!key) throw new AIProviderError("OPENAI_API_KEY is not set.", "openai");
    return createOpenAIProvider(key, { embeddingModel: serverEnv.embeddingModel() });
  }

  throw new AIProviderError(`Unknown AI_EMBEDDING_PROVIDER "${choice}".`, choice);
}

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  const text = resolveTextProvider();
  const embeddings = resolveEmbeddingProvider();

  cached = {
    name: `${text.name}+${embeddings.name}`,
    async generateEmbedding(input: string): Promise<number[]> {
      return assertEmbedding(await embeddings.generateEmbedding(input));
    },
    generateText(input: GenerationInput): Promise<GenerationOutput> {
      return text.generateText(input);
    },
    ...(text.transcribeImage
      ? {
          transcribeImage: (input: ImageTranscriptionInput): Promise<string> =>
            text.transcribeImage!(input),
        }
      : {}),
  };

  return cached;
}

/** Test seam: lets suites install a fake provider. */
export function setAIProvider(provider: AIProvider | null): void {
  cached = provider;
}
