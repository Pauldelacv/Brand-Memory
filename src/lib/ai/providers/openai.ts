import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/types";
import type {
  AIProvider,
  GenerationInput,
  GenerationOutput,
  ImageTranscriptionInput,
} from "@/lib/ai/types";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

const DEFAULT_TEXT_MODEL = "gpt-4.1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function createOpenAIProvider(
  apiKey: string,
  options: { textModel?: string; embeddingModel?: string } = {},
): AIProvider {
  const client = new OpenAI({ apiKey });
  const textModel = options.textModel ?? DEFAULT_TEXT_MODEL;
  const embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;

  return {
    name: "openai",

    async generateEmbedding(input: string): Promise<number[]> {
      try {
        const response = await client.embeddings.create({
          model: embeddingModel,
          input,
          dimensions: EMBEDDING_DIMENSIONS,
        });
        const vector = response.data[0]?.embedding;
        if (!vector) {
          throw new AIProviderError("The embeddings response was empty.", "openai");
        }
        return vector;
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        throw new AIProviderError("Embedding generation failed.", "openai", error);
      }
    },

    async generateText(input: GenerationInput): Promise<GenerationOutput> {
      try {
        const response = await client.chat.completions.create({
          model: textModel,
          max_tokens: input.maxTokens ?? 2048,
          temperature: input.temperature ?? 0.4,
          ...(input.json ? { response_format: { type: "json_object" as const } } : {}),
          messages: [
            { role: "system", content: input.system },
            ...input.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
        });

        const text = response.choices[0]?.message.content?.trim();
        if (!text) {
          throw new AIProviderError("The model returned an empty response.", "openai");
        }

        return { text, model: response.model };
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        throw new AIProviderError("Text generation failed.", "openai", error);
      }
    },

    async transcribeImage(input: ImageTranscriptionInput): Promise<string> {
      try {
        const response = await client.chat.completions.create({
          model: textModel,
          max_tokens: 1500,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: input.instruction },
                {
                  type: "image_url",
                  image_url: { url: `data:${input.mimeType};base64,${input.base64}` },
                },
              ],
            },
          ],
        });

        return response.choices[0]?.message.content?.trim() ?? "";
      } catch (error) {
        throw new AIProviderError("Reading the image failed.", "openai", error);
      }
    },
  };
}
