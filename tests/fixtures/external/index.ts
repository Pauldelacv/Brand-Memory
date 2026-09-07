import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExternalTheme, InternalClaim } from "@/lib/external/cross-analysis";
import type { ObservationPoint } from "@/lib/external/timeline";
import type { ExternalMemoryKind } from "@/types/external";

/** Fixtures for a fictional frame builder, spanning 2022 to 2025. */

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf-8");
}

export function internalClaim(overrides: Partial<InternalClaim> = {}): InternalClaim {
  return {
    id: crypto.randomUUID(),
    category: "POSITIONING",
    title: "Positioning",
    content: "Velvire is a premium, exclusive frame builder selling in small runs.",
    origin: "AI_EXTRACTED",
    confidence: 0.8,
    updatedAt: "2025-01-01T00:00:00.000Z",
    embedding: null,
    ...overrides,
  };
}

export function externalTheme(overrides: Partial<ExternalTheme> = {}): ExternalTheme {
  return {
    id: crypto.randomUUID(),
    kind: "MESSAGE",
    label: "durability",
    title: "Durability",
    content: "Every frame can be repaired, whatever its age.",
    confidence: 0.8,
    firstSeenAt: "2023-01-01T00:00:00.000Z",
    lastSeenAt: "2025-06-01T00:00:00.000Z",
    occurrenceCount: 6,
    sourceCount: 4,
    embedding: null,
    ...overrides,
  };
}

/**
 * Builds dated observations for a theme, spread evenly between two dates.
 * Each observation gets its own source, so source diversity is meaningful.
 */
export function observations(
  entryId: string,
  label: string,
  dates: readonly string[],
  kind: ExternalMemoryKind = "MESSAGE",
): ObservationPoint[] {
  return dates.map((date, index) => ({
    entryId,
    label,
    kind,
    sourceId: `${entryId}-source-${index}`,
    observedAt: new Date(date).toISOString(),
  }));
}

export function monthlyDates(from: string, count: number, stepMonths = 1): string[] {
  const start = new Date(from);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getTime());
    date.setUTCMonth(date.getUTCMonth() + index * stepMonths);
    return date.toISOString();
  });
}

/** "Now" for every temporal test, so results never depend on the wall clock. */
export const NOW = new Date("2026-01-15T00:00:00.000Z");
