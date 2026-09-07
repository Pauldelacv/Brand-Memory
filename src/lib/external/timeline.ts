import type { ExternalMemoryKind } from "@/types/external";

/**
 * Temporal aggregation over external memory.
 *
 * Every question the product needs to answer about time — what was dominant in
 * 2022, what appeared in 2024, what has gone quiet, what is growing — is an
 * aggregation over dated observations. Keeping that logic pure here means it
 * can be tested against fixtures spanning several years without a database.
 */

export const GRANULARITIES = ["MONTH", "QUARTER", "YEAR"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface ObservationPoint {
  entryId: string;
  label: string;
  kind: ExternalMemoryKind;
  sourceId: string;
  /** ISO timestamp: the publication date of the content, not the ingestion date. */
  observedAt: string;
  publisher?: string | null;
}

export interface PeriodBucket {
  period: string;
  label: string;
  count: number;
  sourceCount: number;
}

export function periodKey(iso: string, granularity: Granularity): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";

  const year = date.getUTCFullYear();
  if (granularity === "YEAR") return String(year);

  const month = date.getUTCMonth();
  if (granularity === "QUARTER") return `${year}-Q${Math.floor(month / 3) + 1}`;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function periodLabel(period: string, granularity: Granularity): string {
  if (granularity === "YEAR" || granularity === "QUARTER") return period;

  const [year, month] = period.split("-");
  if (!year || !month) return period;

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

function nextPeriod(period: string, granularity: Granularity): string {
  if (granularity === "YEAR") return String(Number(period) + 1);

  if (granularity === "QUARTER") {
    const [year, quarter] = period.split("-Q");
    const q = Number(quarter);
    return q === 4 ? `${Number(year) + 1}-Q1` : `${year}-Q${q + 1}`;
  }

  const [year, month] = period.split("-");
  const m = Number(month);
  return m === 12 ? `${Number(year) + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Counts per period, with the empty periods in between filled in — a gap in
 * publishing is information, and a chart that skips it lies about the shape.
 */
export function bucketObservations(
  points: readonly ObservationPoint[],
  granularity: Granularity,
): PeriodBucket[] {
  const counts = new Map<string, { count: number; sources: Set<string> }>();

  for (const point of points) {
    const key = periodKey(point.observedAt, granularity);
    if (key === "unknown") continue;

    const bucket = counts.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.sources.add(point.sourceId);
    } else {
      counts.set(key, { count: 1, sources: new Set([point.sourceId]) });
    }
  }

  const keys = [...counts.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return [];

  const buckets: PeriodBucket[] = [];
  let cursor = first;

  // Guard against a malformed date producing an unbounded walk.
  for (let step = 0; step < 600; step += 1) {
    const entry = counts.get(cursor);
    buckets.push({
      period: cursor,
      label: periodLabel(cursor, granularity),
      count: entry?.count ?? 0,
      sourceCount: entry?.sources.size ?? 0,
    });
    if (cursor === last) break;
    cursor = nextPeriod(cursor, granularity);
  }

  return buckets;
}

export type Trend = "NEW" | "RISING" | "STABLE" | "FALLING" | "DORMANT";

export interface ThemeTrajectory {
  entryId: string;
  label: string;
  kind: ExternalMemoryKind;
  total: number;
  sourceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  recentCount: number;
  earlierCount: number;
  /** Share of all observations in the recent window. */
  recentShare: number;
  trend: Trend;
  buckets: PeriodBucket[];
}

export interface TrajectoryOptions {
  granularity?: Granularity;
  /** Length of the "recent" window in months. */
  windowMonths?: number;
  /** Injected so tests are not tied to the wall clock. */
  now?: Date;
}

export function windowStart(now: Date, months: number): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - months);
  return start;
}

/**
 * A theme needs some history before "before" and "after" can be compared. One
 * mention a week before the window opens is not a trend to measure against — it
 * is the same arrival as the mentions inside the window.
 */
const MIN_HISTORY_MONTHS = 2;

/** Occurrence rate per month, so windows of different lengths are comparable. */
function monthlyRate(count: number, fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return count;

  const months = Math.max((to - from) / (1000 * 60 * 60 * 24 * 30.44), 1);
  return count / months;
}

export function themeTrajectories(
  points: readonly ObservationPoint[],
  options: TrajectoryOptions = {},
): ThemeTrajectory[] {
  const granularity = options.granularity ?? "QUARTER";
  const windowMonths = options.windowMonths ?? 12;
  const now = options.now ?? new Date();
  const cutoff = windowStart(now, windowMonths);

  const grouped = new Map<string, ObservationPoint[]>();
  for (const point of points) {
    const existing = grouped.get(point.entryId);
    if (existing) existing.push(point);
    else grouped.set(point.entryId, [point]);
  }

  const recentTotal = points.filter((point) => Date.parse(point.observedAt) >= cutoff.getTime()).length;

  const trajectories: ThemeTrajectory[] = [];

  for (const [entryId, group] of grouped) {
    const sorted = [...group].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) continue;

    const recent = sorted.filter((point) => Date.parse(point.observedAt) >= cutoff.getTime());
    const earlier = sorted.filter((point) => Date.parse(point.observedAt) < cutoff.getTime());

    const recentRate = monthlyRate(recent.length, cutoff.toISOString(), now.toISOString());
    const earlierSpanMonths =
      (cutoff.getTime() - Date.parse(first.observedAt)) / (1000 * 60 * 60 * 24 * 30.44);
    const hasHistory = earlier.length > 0 && earlierSpanMonths >= MIN_HISTORY_MONTHS;
    const earlierRate = hasHistory
      ? monthlyRate(earlier.length, first.observedAt, cutoff.toISOString())
      : 0;

    trajectories.push({
      entryId,
      label: first.label,
      kind: first.kind,
      total: sorted.length,
      sourceCount: new Set(sorted.map((point) => point.sourceId)).size,
      firstSeenAt: first.observedAt,
      lastSeenAt: last.observedAt,
      recentCount: recent.length,
      earlierCount: earlier.length,
      recentShare: recentTotal === 0 ? 0 : recent.length / recentTotal,
      trend: classifyTrend(recent.length, hasHistory ? earlier.length : 0, recentRate, earlierRate),
      buckets: bucketObservations(sorted, granularity),
    });
  }

  return trajectories.sort((a, b) => b.total - a.total);
}

export function classifyTrend(
  recentCount: number,
  earlierCount: number,
  recentRate: number,
  earlierRate: number,
): Trend {
  if (earlierCount === 0 && recentCount > 0) return "NEW";
  if (recentCount === 0 && earlierCount > 0) return "DORMANT";
  if (earlierRate === 0) return recentCount > 0 ? "RISING" : "STABLE";
  if (recentRate >= earlierRate * 1.5) return "RISING";
  if (recentRate <= earlierRate * 0.5) return "FALLING";
  return "STABLE";
}

export interface DominantTheme {
  entryId: string;
  label: string;
  count: number;
  share: number;
}

/** The themes that carried a period. Used by "what was dominant in 2022". */
export function dominantThemes(
  points: readonly ObservationPoint[],
  period: string,
  granularity: Granularity,
  limit = 8,
): DominantTheme[] {
  const inPeriod = points.filter((point) => periodKey(point.observedAt, granularity) === period);
  if (inPeriod.length === 0) return [];

  const counts = new Map<string, { label: string; count: number }>();
  for (const point of inPeriod) {
    const entry = counts.get(point.entryId);
    if (entry) entry.count += 1;
    else counts.set(point.entryId, { label: point.label, count: 1 });
  }

  return [...counts.entries()]
    .map(([entryId, value]) => ({
      entryId,
      label: value.label,
      count: value.count,
      share: value.count / inPeriod.length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface TermShift {
  term: string;
  earlier: number;
  recent: number;
  /** Positive when the term is used more now than before. */
  delta: number;
}

export interface DatedTerms {
  at: string;
  terms: readonly string[];
}

/**
 * Compares how often each term is used before and after a cutoff, as a share of
 * its window. Used for tone drift: "playful" in 40% of 2022 content and 5% of
 * 2025 content is a statement anyone can check.
 */
export function termShift(documents: readonly DatedTerms[], cutoff: Date): TermShift[] {
  const earlier = new Map<string, number>();
  const recent = new Map<string, number>();
  let earlierDocuments = 0;
  let recentDocuments = 0;

  for (const document of documents) {
    const time = Date.parse(document.at);
    if (!Number.isFinite(time)) continue;

    const isRecent = time >= cutoff.getTime();
    const target = isRecent ? recent : earlier;
    if (isRecent) recentDocuments += 1;
    else earlierDocuments += 1;

    for (const term of new Set(document.terms.map((value) => value.trim().toLowerCase()).filter(Boolean))) {
      target.set(term, (target.get(term) ?? 0) + 1);
    }
  }

  // A comparison needs two sides. With one window empty every term would read
  // as having appeared from nothing or vanished entirely, which is a statement
  // about the corpus, not about the tone.
  if (earlierDocuments === 0 || recentDocuments === 0) return [];

  const terms = new Set([...earlier.keys(), ...recent.keys()]);
  const shifts: TermShift[] = [];

  for (const term of terms) {
    const earlierShare = earlierDocuments === 0 ? 0 : (earlier.get(term) ?? 0) / earlierDocuments;
    const recentShare = recentDocuments === 0 ? 0 : (recent.get(term) ?? 0) / recentDocuments;
    shifts.push({
      term,
      earlier: earlierShare,
      recent: recentShare,
      delta: recentShare - earlierShare,
    });
  }

  return shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Total distance between the two tone distributions, 0..1. */
export function distributionDistance(shifts: readonly TermShift[]): number {
  const total = shifts.reduce((sum, shift) => sum + Math.abs(shift.delta), 0);
  return Math.min(total / 2, 1);
}
