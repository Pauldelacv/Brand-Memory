import { z } from "zod";
import { GENERATION_MODES, MEMORY_CATEGORIES, RETRIEVAL_KINDS } from "@/types/domain";
import {
  BRAND_INSIGHT_KINDS,
  EXTERNAL_CONNECTOR_KINDS,
  EXTERNAL_MEMORY_KINDS,
  EXTERNAL_SOURCE_TYPES,
  EXTERNAL_SYNC_FREQUENCIES,
} from "@/types/external";

/** Anything crossing a trust boundary — forms, API bodies, AI output — parses through here. */

export const emailSchema = z.email("Enter a valid email address.");
export const passwordSchema = z.string().min(8, "Use at least 8 characters.");

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "A brand needs a name.").max(120),
  description: z.string().trim().max(2000).default(""),
  industry: z.string().trim().max(120).default(""),
  website: z
    .union([z.url("Enter a full URL, including https://"), z.literal("")])
    .optional()
    .transform((value) => (value ? value : null)),
  audience: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value ? value : null)),
  positioning: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value ? value : null)),
});

export type BrandInput = z.infer<typeof brandInputSchema>;

export const uuidSchema = z.uuid("Expected an identifier.");

export const sourceReferenceSchema = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
  excerpt: z.string(),
});

export const sourceReferencesSchema = z.array(sourceReferenceSchema);

export const citationSchema = z.object({
  kind: z.enum(RETRIEVAL_KINDS),
  refId: z.string(),
  label: z.string(),
  excerpt: z.string(),
  similarity: z.number(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  url: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
});

export const citationsSchema = z.array(citationSchema);

export const memoryEntryInputSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  title: z.string().trim().min(1, "Give this entry a title.").max(160),
  content: z.string().trim().min(1, "Add some content.").max(8000),
});

export const generateInputSchema = z.object({
  brandId: uuidSchema,
  conversationId: uuidSchema.nullable().optional(),
  mode: z.enum(GENERATION_MODES).default("ASK"),
  prompt: z.string().trim().min(3, "Ask something first.").max(4000),
});

export type GenerateInput = z.infer<typeof generateInputSchema>;

/**
 * Structured brand analysis returned by the LLM during extraction.
 * AI output is never persisted before it passes this schema.
 */
export const brandAnalysisSchema = z.object({
  entries: z
    .array(
      z.object({
        category: z.enum(MEMORY_CATEGORIES),
        title: z.string().trim().min(1).max(160),
        content: z.string().trim().min(1).max(4000),
        confidence: z.number().min(0).max(1),
        evidence: z
          .array(
            z.object({
              chunkId: z.string(),
              excerpt: z.string().max(600),
            }),
          )
          .default([]),
      }),
    )
    .max(40),
});

export type BrandAnalysis = z.infer<typeof brandAnalysisSchema>;


/* ---------------------------------------------------------------------------
 * External Brand Memory
 *
 * Two trust boundaries need covering here that the internal half does not have:
 * URLs a user asks the server to fetch, and structured readings of content the
 * brand did not write. Both are validated before anything acts on them.
 * ------------------------------------------------------------------------- */

/**
 * Shape-level URL validation for forms. The SSRF guard — private addresses,
 * ports, credentials, DNS — lives in `lib/external/url.ts` and runs on the
 * server; this only keeps obvious rubbish out of the form.
 */
export const publicUrlSchema = z
  .string()
  .trim()
  .min(1, "Paste a URL.")
  .max(2048, "That URL is too long.")
  .refine((value) => /^https?:\/\//i.test(value), "The URL must start with http:// or https://")
  .refine((value) => {
    try {
      const url = new URL(value);
      return Boolean(url.hostname) && url.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Enter a full URL, including the domain.");

export const externalUrlInputSchema = z.object({
  brandId: uuidSchema,
  url: publicUrlSchema,
  sourceType: z.enum(EXTERNAL_SOURCE_TYPES).optional(),
});

export const externalFeedInputSchema = z.object({
  brandId: uuidSchema,
  kind: z.enum(EXTERNAL_CONNECTOR_KINDS),
  url: publicUrlSchema,
  label: z.string().trim().max(120).default(""),
  frequency: z.enum(EXTERNAL_SYNC_FREQUENCIES).default("MANUAL"),
  maxDocuments: z.coerce.number().int().min(1).max(200).default(25),
});

export const ownedDomainsSchema = z
  .string()
  .trim()
  .max(2000)
  .transform((value) =>
    value
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter((entry) => entry.length > 0 && entry.includes("."))
      .slice(0, 20),
  );

/**
 * The structured reading of one public content.
 *
 * `label` is the theme key: normalised on our side, and the thing that lets the
 * same message found in nine articles collapse into one theme with nine dated
 * observations rather than nine unrelated entries.
 */
export const externalAnalysisSchema = z.object({
  summary: z.string().trim().max(1500).default(""),
  language: z.string().trim().max(12).optional(),
  narrative: z.string().trim().max(600).default(""),
  tone: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  entries: z
    .array(
      z.object({
        kind: z.enum(EXTERNAL_MEMORY_KINDS),
        label: z.string().trim().min(1).max(80),
        statement: z.string().trim().min(1).max(600),
        confidence: z.number().min(0).max(1),
        excerpt: z.string().trim().max(600).default(""),
      }),
    )
    .max(30)
    .default([]),
});

export type ExternalAnalysis = z.infer<typeof externalAnalysisSchema>;

/**
 * The model's verdict on contradiction candidates the deterministic pass found.
 * It can only confirm, reject or reword — it never introduces a pair, so a
 * hallucinated contradiction cannot reach the dashboard.
 */
export const contradictionJudgementSchema = z.object({
  verdicts: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        contradiction: z.boolean(),
        confidence: z.number().min(0).max(1),
        reason: z.string().trim().max(400).default(""),
      }),
    )
    .max(40)
    .default([]),
});

export const scoreComponentSchema = z.object({
  name: z.string(),
  value: z.number(),
  weight: z.number(),
  detail: z.string().default(""),
});

export const scoreComponentsSchema = z.array(scoreComponentSchema);

export const insightEvidenceSchema = z
  .object({
    externalOccurrences: z.number().optional(),
    externalSources: z.number().optional(),
    firstSeenAt: z.string().nullable().optional(),
    lastSeenAt: z.string().nullable().optional(),
    recentOccurrences: z.number().optional(),
    earlierOccurrences: z.number().optional(),
    share: z.number().optional(),
    similarity: z.number().optional(),
    internalTitles: z.array(z.string()).optional(),
    externalLabels: z.array(z.string()).optional(),
    periods: z.array(z.object({ period: z.string(), count: z.number() })).optional(),
    terms: z
      .array(z.object({ term: z.string(), earlier: z.number(), recent: z.number() }))
      .optional(),
  })
  .loose();

export const insightKindSchema = z.enum(BRAND_INSIGHT_KINDS);

/** Formats a ZodError into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}
