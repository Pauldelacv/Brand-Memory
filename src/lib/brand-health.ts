import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from "@/types/domain";
import type { BrandSource, MemoryCategory, MemoryEntry } from "@/types/domain";

/**
 * "Brand completeness" on the overview screen: which parts of the memory model
 * the uploaded knowledge actually covers.
 */

export interface BrandCompleteness {
  /** 0..1 */
  score: number;
  covered: MemoryCategory[];
  missing: MemoryCategory[];
  missingLabels: string[];
}

export function computeCompleteness(entries: readonly MemoryEntry[]): BrandCompleteness {
  const present = new Set(entries.map((entry) => entry.category));
  const covered = MEMORY_CATEGORIES.filter((category) => present.has(category));
  const missing = MEMORY_CATEGORIES.filter((category) => !present.has(category));

  return {
    score: covered.length / MEMORY_CATEGORIES.length,
    covered,
    missing,
    missingLabels: missing.map((category) => MEMORY_CATEGORY_LABELS[category]),
  };
}

export interface SourceBreakdown {
  total: number;
  ready: number;
  processing: number;
  failed: number;
  chunks: number;
}

export function summariseSources(sources: readonly BrandSource[]): SourceBreakdown {
  return {
    total: sources.length,
    ready: sources.filter((source) => source.status === "READY").length,
    processing: sources.filter(
      (source) => source.status === "PROCESSING" || source.status === "UPLOADED",
    ).length,
    failed: sources.filter((source) => source.status === "FAILED").length,
    chunks: sources.reduce((sum, source) => sum + source.chunkCount, 0),
  };
}
