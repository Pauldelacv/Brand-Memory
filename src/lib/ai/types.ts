/** The seam between the application and any AI vendor. */

export interface GenerationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerationInput {
  system: string;
  messages: GenerationMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for a single JSON object. Callers still validate the result. */
  json?: boolean;
}

export interface GenerationOutput {
  text: string;
  model: string;
}

export interface ImageTranscriptionInput {
  base64: string;
  mimeType: string;
  /** What the caller wants read out of the image. */
  instruction: string;
}

export interface AIProvider {
  readonly name: string;
  generateEmbedding(input: string): Promise<number[]>;
  generateText(input: GenerationInput): Promise<GenerationOutput>;
  /**
   * Optional. Used by the ingestion pipeline to read text and visual direction
   * out of image sources. Providers without vision simply omit it, and
   * ingestion reports the source as unsupported rather than failing silently.
   */
  transcribeImage?(input: ImageTranscriptionInput): Promise<string>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export class AICapabilityError extends AIProviderError {
  constructor(provider: string, capability: string) {
    super(`Provider "${provider}" does not support ${capability}.`, provider);
    this.name = "AICapabilityError";
  }
}
