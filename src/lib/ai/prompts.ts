import type { Brand, GenerationMode } from "@/types/domain";

/** Prompt construction lives here so the wording is reviewable in one place. */

const BASE_RULES = [
  "You are the brand intelligence layer for a creative team.",
  "Answer only from the BRAND MEMORY block supplied with the request.",
  "If the memory does not cover something, say so plainly instead of inventing it.",
  "Never soften or merge contradictory sources: if the block lists contradictions, state which position you used and why.",
  "Cite the numbered context entries you relied on as [1], [2] and so on.",
  "Context entries marked 'public communication' are things the brand actually published, with dates.",
  "Treat them as evidence of what was said in public, never as the brand's current doctrine, and say so when you use them.",
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

/* ---------------------------------------------------------------------------
 * External Brand Memory
 * ------------------------------------------------------------------------- */

export const EXTERNAL_EXTRACTION_SYSTEM_PROMPT = [
  "You read one piece of content a brand has published or that was published about it,",
  "and record what it communicates. You are building a memory of public communication,",
  "not summarising an article.",
  "Return a single JSON object and nothing else — no prose, no markdown fence.",
  "",
  "Shape:",
  '{ "summary": string, "language": string, "narrative": string, "tone": string[],',
  '  "entries": [ { "kind": KIND, "label": string, "statement": string, "confidence": number, "excerpt": string } ] }',
  "",
  "KIND is one of: IDENTITY, POSITIONING, AUDIENCE, PERSONALITY, VOICE, VALUES, PRODUCT,",
  "SERVICE, MESSAGE, CLAIM, TOPIC, NARRATIVE, SPOKESPERSON, CREATIVE_THEME, STRATEGIC_THEME.",
  "",
  "Rules:",
  '- label is the theme in two or three lowercase words, e.g. "sustainability", "premium craftsmanship",',
  '  "female cyclists". Reuse the same wording for the same theme across different contents: the label is',
  "  what lets one message found in nine articles count as one theme said nine times.",
  "- statement is what this content says about that theme, in one or two sentences, in English.",
  "- excerpt must be copied verbatim from the content. Never paraphrase it.",
  "- confidence is 0..1 and reflects how explicitly the content supports the statement.",
  "- tone is at most six single adjectives describing how it is written, lowercase.",
  "- narrative is the story the content tells about the brand, in one sentence.",
  "- Record only what this content actually says. An empty entries array is a valid answer.",
  "- Do not infer what the brand is like in general. This is one dated piece of evidence.",
  "- If the content is not about the brand at all, return an empty entries array.",
].join("\n");

export function externalExtractionUserPrompt(
  brand: Brand,
  content: {
    title: string;
    publisher: string | null;
    author: string | null;
    publishedAt: string | null;
    url: string;
    body: string;
  },
  maxChars = 12000,
): string {
  const header = [
    `Title: ${content.title || "(untitled)"}`,
    content.publisher ? `Publisher: ${content.publisher}` : null,
    content.author ? `Author: ${content.author}` : null,
    content.publishedAt ? `Published: ${content.publishedAt.slice(0, 10)}` : null,
    `URL: ${content.url}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return [
    "BRAND PROFILE",
    brandProfile(brand),
    "",
    "PUBLISHED CONTENT",
    header,
    "",
    content.body.slice(0, maxChars),
  ].join("\n");
}

export const CONTRADICTION_JUDGE_SYSTEM_PROMPT = [
  "You review candidate contradictions between a brand's internal memory (what it says it is)",
  "and its public communication (what it actually published).",
  "Return a single JSON object and nothing else — no prose, no markdown fence.",
  "",
  'Shape: { "verdicts": [ { "id": string, "contradiction": boolean, "confidence": number, "reason": string } ] }',
  "",
  "Rules:",
  "- Judge only the pairs you are given. Never introduce a pair of your own.",
  "- id must be copied exactly from the candidate.",
  "- contradiction is true only when both statements cannot be true of the same brand at the same time.",
  "- Two statements about different aspects of the brand are not a contradiction.",
  "- A deliberate tension the brand states on purpose is not a contradiction.",
  "- A change over time is a contradiction only if the internal memory still asserts the old position.",
  "- reason is one sentence, and must refer to the two statements.",
].join("\n");

export function contradictionJudgeUserPrompt(
  brand: Brand,
  candidates: Array<{ id: string; internal: string; external: string; occurrences: number; lastSeen: string | null }>,
): string {
  const body = candidates
    .map((candidate) =>
      [
        `id: ${candidate.id}`,
        `internal memory: ${candidate.internal}`,
        `public communication (${candidate.occurrences} content${candidate.occurrences === 1 ? "" : "s"}${
          candidate.lastSeen ? `, last on ${candidate.lastSeen.slice(0, 10)}` : ""
        }): ${candidate.external}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return ["BRAND PROFILE", brandProfile(brand), "", "CANDIDATE PAIRS", body].join("\n");
}
