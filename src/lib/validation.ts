import { z } from "zod";
import { GENERATION_MODES, MEMORY_CATEGORIES } from "@/types/domain";

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
  kind: z.enum(["MEMORY", "DOCUMENT"]),
  refId: z.string(),
  label: z.string(),
  excerpt: z.string(),
  similarity: z.number(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
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

/** Formats a ZodError into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}
