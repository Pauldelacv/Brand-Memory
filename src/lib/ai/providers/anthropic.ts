import Anthropic from "@anthropic-ai/sdk";
import { AICapabilityError, AIProviderError } from "@/lib/ai/types";
import type {
  AIProvider,
  GenerationInput,
  GenerationOutput,
  ImageTranscriptionInput,
} from "@/lib/ai/types";

const DEFAULT_MODEL = "claude-sonnet-5";

export function createAnthropicProvider(apiKey: string, model = DEFAULT_MODEL): AIProvider {
  const client = new Anthropic({ apiKey });

  return {
    name: "anthropic",

    async generateEmbedding(): Promise<number[]> {
      // Anthropic exposes no embeddings endpoint; pair it with another provider.
      throw new AICapabilityError("anthropic", "embeddings");
    },

    async generateText(input: GenerationInput): Promise<GenerationOutput> {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: input.maxTokens ?? 2048,
          temperature: input.temperature ?? 0.4,
          system: input.system,
          messages: input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });

        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();

        if (!text) {
          throw new AIProviderError("The model returned an empty response.", "anthropic");
        }

        return { text, model: response.model };
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        throw new AIProviderError("Text generation failed.", "anthropic", error);
      }
    },

    async transcribeImage(input: ImageTranscriptionInput): Promise<string> {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 1500,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: input.mimeType as "image/png",
                    data: input.base64,
                  },
                },
                { type: "text", text: input.instruction },
              ],
            },
          ],
        });

        return response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();
      } catch (error) {
        throw new AIProviderError("Reading the image failed.", "anthropic", error);
      }
    },
  };
}
