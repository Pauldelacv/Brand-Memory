import type {
  MemoryCategory,
  MemoryOrigin,
  RetrievalCitation,
  RetrievalKind,
} from "@/types/domain";

/**
 * Pure retrieval logic: rank, deduplicate, resolve contradictions and build a
 * selective context. No IO here so it can be tested directly.
 */

export interface RetrievalCandidate {
  kind: RetrievalKind;
  refId: string;
  /** Human readable name used in the attribution panel. */
  label: string;
  content: string;
  /** Cosine similarity from pgvector, 0..1. */
  similarity: number;
  sourceId: string | null;
  sourceName: string | null;
  /** Memory entries only. */
  category: MemoryCategory | null;
  origin: MemoryOrigin | null;
  /** Documents only: flagged by the user as an official/authoritative source. */
  authoritative: boolean;
  /** Documents only: the date the source describes, used for recency. */
  sourceDate: string | null;
  /** User-assigned source priority, higher wins. */
  priority: number;
  updatedAt: string | null;
  /** External candidates only: where the public record can be read. */
  url?: string | null;
  /** External candidates only: when the brand said it. */
  publishedAt?: string | null;
}

/** True for the two kinds that come from the external (public) memory. */
export function isExternalKind(kind: RetrievalKind): boolean {
  return kind === "EXTERNAL_MEMORY" || kind === "EXTERNAL_DOCUMENT";
}

export interface RankedCandidate extends RetrievalCandidate {
  score: number;
  authorityTier: AuthorityTier;
}

export interface ConflictNote {
  topic: string;
  keptRefId: string;
  keptSummary: string;
  supersededSummaries: string[];
  reason: string;
}

/**
 * MVP conflict ladder, straight from the product spec:
 *   user-edited memory > newest official source > other sources > AI inference
 * Lower number wins.
 *
 * PUBLIC_RECORD sits between the two: what the brand published is evidence, and
 * stronger than an inference, but it does not outrank the brand's own current
 * doctrine — a 2019 press release is not a correction of the 2025 guidelines.
 * Whether the two disagree is a question for cross analysis, not for this
 * ladder, which is why external candidates never enter conflict resolution.
 */
export const AUTHORITY_TIERS = {
  USER_EDITED: 0,
  OFFICIAL_SOURCE: 1,
  OTHER_SOURCE: 2,
  PUBLIC_RECORD: 3,
  AI_INFERENCE: 4,
} as const;

export type AuthorityTier = (typeof AUTHORITY_TIERS)[keyof typeof AUTHORITY_TIERS];

export function authorityTier(candidate: RetrievalCandidate): AuthorityTier {
  if (isExternalKind(candidate.kind)) return AUTHORITY_TIERS.PUBLIC_RECORD;

  if (candidate.kind === "MEMORY") {
    return candidate.origin === "USER_EDITED"
      ? AUTHORITY_TIERS.USER_EDITED
      : AUTHORITY_TIERS.AI_INFERENCE;
  }
  return candidate.authoritative ? AUTHORITY_TIERS.OFFICIAL_SOURCE : AUTHORITY_TIERS.OTHER_SOURCE;
}

const TIER_WEIGHT: Record<AuthorityTier, number> = {
  [AUTHORITY_TIERS.USER_EDITED]: 1,
  [AUTHORITY_TIERS.OFFICIAL_SOURCE]: 0.85,
  [AUTHORITY_TIERS.OTHER_SOURCE]: 0.6,
  [AUTHORITY_TIERS.PUBLIC_RECORD]: 0.55,
  [AUTHORITY_TIERS.AI_INFERENCE]: 0.5,
};

const SIMILARITY_WEIGHT = 0.7;
const AUTHORITY_WEIGHT = 0.25;
const PRIORITY_WEIGHT = 0.05;

export function scoreCandidate(candidate: RetrievalCandidate): RankedCandidate {
  const tier = authorityTier(candidate);
  // Priority is user-supplied and unbounded; squash it into 0..1.
  const priorityBoost = Math.tanh(Math.max(candidate.priority, 0) / 5);

  const score =
    candidate.similarity * SIMILARITY_WEIGHT +
    TIER_WEIGHT[tier] * AUTHORITY_WEIGHT +
    priorityBoost * PRIORITY_WEIGHT;

  return { ...candidate, score, authorityTier: tier };
}

/** Timestamp used for recency tie-breaks; 0 when the source carries no date. */
export function recencyOf(candidate: RetrievalCandidate): number {
  const raw = candidate.sourceDate ?? candidate.publishedAt ?? candidate.updatedAt;
  if (!raw) return 0;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Two memory entries under the same category with the same title are competing
 * claims about the same thing. That pairing is what we treat as a contradiction.
 */
function claimTopic(candidate: RankedCandidate): string | null {
  // Only internal memory competes for a claim slot. An external theme that
  // disagrees with the brand's own memory is a finding for cross analysis, and
  // dropping it here would hide exactly what the product exists to surface.
  if (candidate.kind !== "MEMORY" || !candidate.category) return null;
  return `${candidate.category}:${normalizeText(candidate.label)}`;
}

/** Highest authority wins; ties break on recency, then score. */
export function compareAuthority(a: RankedCandidate, b: RankedCandidate): number {
  if (a.authorityTier !== b.authorityTier) return a.authorityTier - b.authorityTier;
  const recency = recencyOf(b) - recencyOf(a);
  if (recency !== 0) return recency;
  return b.score - a.score;
}

export interface ResolvedCandidates {
  kept: RankedCandidate[];
  conflicts: ConflictNote[];
}

/**
 * Drops contradictory claims instead of merging them, and reports what was
 * dropped so the answer can say the sources disagree.
 */
export function resolveConflicts(candidates: RankedCandidate[]): ResolvedCandidates {
  const groups = new Map<string, RankedCandidate[]>();
  const passthrough: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const topic = claimTopic(candidate);
    if (!topic) {
      passthrough.push(candidate);
      continue;
    }
    const group = groups.get(topic);
    if (group) group.push(candidate);
    else groups.set(topic, [candidate]);
  }

  const kept: RankedCandidate[] = [...passthrough];
  const conflicts: ConflictNote[] = [];

  for (const [topic, group] of groups) {
    const ordered = [...group].sort(compareAuthority);
    const winner = ordered[0];
    if (!winner) continue;
    kept.push(winner);

    const losers = ordered
      .slice(1)
      .filter((entry) => normalizeText(entry.content) !== normalizeText(winner.content));

    if (losers.length > 0) {
      conflicts.push({
        topic,
        keptRefId: winner.refId,
        keptSummary: `${winner.label}: ${winner.content}`,
        supersededSummaries: losers.map((entry) => `${entry.label}: ${entry.content}`),
        reason: conflictReason(winner, losers[0]!),
      });
    }
  }

  return { kept: kept.sort((a, b) => b.score - a.score), conflicts };
}

function conflictReason(winner: RankedCandidate, loser: RankedCandidate): string {
  if (winner.authorityTier !== loser.authorityTier) {
    if (winner.authorityTier === AUTHORITY_TIERS.USER_EDITED) {
      return "kept the entry a person edited over the AI-extracted one";
    }
    if (winner.authorityTier === AUTHORITY_TIERS.OFFICIAL_SOURCE) {
      return "kept the entry backed by an official source";
    }
    return "kept the entry from the higher-priority source";
  }
  return "kept the more recent entry";
}

/** Removes repeats of the same passage, keeping the best-scoring copy. */
export function dedupe(candidates: RankedCandidate[]): RankedCandidate[] {
  const seen = new Map<string, RankedCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.kind}:${normalizeText(candidate.content).slice(0, 240)}`;
    const existing = seen.get(key);
    if (!existing || candidate.score > existing.score) seen.set(key, candidate);
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}

/** Cheap token estimate. Good enough for a context budget, not for billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BrandContext {
  candidates: RankedCandidate[];
  conflicts: ConflictNote[];
  citations: RetrievalCitation[];
  text: string;
  tokenEstimate: number;
}

export interface BuildContextOptions {
  /** Never send the whole library to the model; the context stays selective. */
  tokenBudget?: number;
  maxCandidates?: number;
}

export function buildBrandContext(
  candidates: RetrievalCandidate[],
  options: BuildContextOptions = {},
): BrandContext {
  const tokenBudget = options.tokenBudget ?? 6000;
  const maxCandidates = options.maxCandidates ?? 12;

  const scored = candidates.map(scoreCandidate);
  const { kept, conflicts } = resolveConflicts(dedupe(scored));

  const selected: RankedCandidate[] = [];
  let used = 0;

  for (const candidate of kept) {
    if (selected.length >= maxCandidates) break;
    const cost = estimateTokens(candidate.content) + 32;
    if (used + cost > tokenBudget && selected.length > 0) continue;
    selected.push(candidate);
    used += cost;
  }

  return {
    candidates: selected,
    conflicts,
    citations: selected.map(toCitation),
    text: renderContext(selected, conflicts),
    tokenEstimate: used,
  };
}

export function toCitation(candidate: RankedCandidate): RetrievalCitation {
  return {
    kind: candidate.kind,
    refId: candidate.refId,
    label: candidate.label,
    excerpt: candidate.content.slice(0, 400),
    similarity: Number(candidate.similarity.toFixed(4)),
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceName,
    url: candidate.url ?? null,
    publishedAt: candidate.publishedAt ?? null,
  };
}

function describeOrigin(candidate: RankedCandidate): string {
  switch (candidate.kind) {
    case "MEMORY":
      return `internal memory / ${candidate.category ?? "UNCATEGORISED"}`;
    case "DOCUMENT":
      return `internal document / ${candidate.sourceName ?? "unknown source"}`;
    case "EXTERNAL_MEMORY":
      return "public communication / recurring theme";
    case "EXTERNAL_DOCUMENT":
      return `public communication / ${candidate.sourceName ?? "published content"}`;
  }
}

export function renderContext(candidates: RankedCandidate[], conflicts: ConflictNote[]): string {
  if (candidates.length === 0) {
    return "No brand knowledge has been retrieved for this request.";
  }

  const blocks = candidates.map((candidate, index) => {
    const origin = describeOrigin(candidate);
    const when = candidate.publishedAt
      ? `published: ${candidate.publishedAt.slice(0, 10)}`
      : null;

    return [
      `[${index + 1}] ${candidate.label}`,
      `origin: ${origin}`,
      when,
      `relevance: ${candidate.similarity.toFixed(2)}`,
      candidate.content,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  });

  if (conflicts.length > 0) {
    blocks.push(
      [
        "CONTRADICTIONS DETECTED",
        ...conflicts.map((conflict) =>
          [
            `topic: ${conflict.topic}`,
            `used: ${conflict.keptSummary}`,
            `superseded: ${conflict.supersededSummaries.join(" | ")}`,
            `reason: ${conflict.reason}`,
          ].join("\n"),
        ),
      ].join("\n"),
    );
  }

  return blocks.join("\n\n---\n\n");
}
