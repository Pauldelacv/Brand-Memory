import type { Brand, GenerationMode } from "@/types/domain";

/** Prompt construction lives here so the wording is reviewable in one place. */

const BASE_RULES = [
  "You are the brand intelligence layer for a creative team.",
  "Answer only from the BRAND MEMORY block supplied with the request.",
  "If the memory does not cover something, say so plainly instead of inventing it.",
  "Never soften or merge contradictory sources: if the block lists contradictions, state which position you used and why.",
  "Cite the numbered context entries you relied on as [1], [2] and so on.",
  "Write in the brand's own tone of voice when the memory describes one.",
  "Do not describe yourself as an AI or narrate your process.",
].join("\n");

const MODE_RULES: Record<GenerationMode, string> = {
  ASK: "Mode: ASK. Answer the question directly and concisely. Lead with the answer, then the supporting detail.",
  CREATE: [
    "Mode: CREATE. Produce creative work for the brand, structured as:",
    "1. Creative concept",
    "2. Strategic rationale",
    "3. Suggested messaging",
    "4. Tone of voice",
    "5. Visual direction",
    "Keep every section grounded in the retrieved memory.",
  ].join("\n"),
  EXPLORE: "Mode: EXPLORE. Offer three to five distinct territories or angles. Give each a name, a one-line idea and the memory it builds on. Make them genuinely different from each other.",
  COMPARE: "Mode: COMPARE. Set the options side by side against the brand's positioning, audience and voice. Be explicit about trade-offs and finish with a recommendation.",
};

export function brandProfile(brand: Brand): string {
  const lines = [
    `Brand: ${brand.name}`,
    brand.industry ? `Industry: ${brand.industry}` : null,
    brand.description ? `Description: ${brand.description}` : null,
    brand.positioning ? `Positioning: ${brand.positioning}` : null,
    brand.audience ? `Audience: ${brand.audience}` : null,
    brand.website ? `Website: ${brand.website}` : null,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

export function generationSystemPrompt(brand: Brand, mode: GenerationMode): string {
  return [BASE_RULES, "", MODE_RULES[mode], "", "BRAND PROFILE", brandProfile(brand)].join("\n");
}

export function generationUserPrompt(context: string, prompt: string): string {
  return ["BRAND MEMORY", context, "", "REQUEST", prompt].join("\n");
}

export const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured brand knowledge from source documents.",
  "Return a single JSON object and nothing else — no prose, no markdown fence.",
  "",
  "Shape:",
  '{ "entries": [ { "category": CATEGORY, "title": string, "content": string, "confidence": number, "evidence": [ { "chunkId": string, "excerpt": string } ] } ] }',
  "",
  "CATEGORY is one of: IDENTITY, POSITIONING, AUDIENCE, PERSONALITY, VOICE, VISUAL_LANGUAGE, VALUES, PRODUCT, CREATIVE_HISTORY.",
  "",
  "Rules:",
  "- One entry per distinct claim. Title it with the claim slot, e.g. \"Tone of voice\", \"Primary audience\".",
  "- content is a short factual statement about the brand, at most three sentences.",
  "- confidence is 0..1 and reflects how directly the excerpts support the claim.",
  "- evidence.chunkId must be one of the chunk ids given to you. Never invent one.",
  "- Extract only what the excerpts support. An empty entries array is a valid answer.",
  "- Do not merge contradictory statements into one entry: emit them separately so the app can resolve them.",
].join("\n");

export function extractionUserPrompt(brand: Brand, chunks: Array<{ id: string; content: string }>) {
  const body = chunks
    .map((chunk) => `chunkId: ${chunk.id}\n${chunk.content}`)
    .join("\n\n---\n\n");

  return ["BRAND PROFILE", brandProfile(brand), "", "SOURCE EXCERPTS", body].join("\n");
}
