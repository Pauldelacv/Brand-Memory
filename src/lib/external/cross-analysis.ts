import { cosineSimilarity } from "@/lib/ai/embeddings";
import {
  distributionDistance,
  periodKey,
  termShift,
  themeTrajectories,
  windowStart,
} from "@/lib/external/timeline";
import type { DatedTerms, ObservationPoint, ThemeTrajectory, TermShift } from "@/lib/external/timeline";
import type { MemoryCategory, MemoryOrigin } from "@/types/domain";
import type { BrandInsightKind, ExternalMemoryKind, InsightEvidence, ScoreComponent } from "@/types/external";

/**
 * Cross analysis: what the brand says it is, measured against what it has
 * actually published.
 *
 * Two rules shape everything here.
 *
 * 1. No arbitrary scores. Every insight carries the components that produced
 *    it — similarity, frequency, recency, source diversity, confidence,
 *    internal priority — with their values and weights, so the interface can
 *    always answer "why does this exist" with numbers rather than adjectives.
 *
 * 2. No IO. The whole analysis is a pure function of the two memories, so the
 *    detection rules can be tested against fixtures spanning several years.
 *
 * Semantic similarity is cosine over the stored embeddings when both sides have
 * one, and a lexical overlap otherwise. The two live on different scales, so
 * each carries its own thresholds rather than pretending one number fits both.
 */

export interface InternalClaim {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  origin: MemoryOrigin;
  confidence: number;
  updatedAt: string;
  embedding: number[] | null;
}

export interface ExternalTheme {
  id: string;
  kind: ExternalMemoryKind;
  label: string;
  title: string;
  content: string;
  confidence: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurrenceCount: number;
  sourceCount: number;
  embedding: number[] | null;
}

export interface CrossAnalysisInput {
  internal: readonly InternalClaim[];
  external: readonly ExternalTheme[];
  observations: readonly ObservationPoint[];
  /** Tone words per published content, dated. Drives tone drift. */
  toneDocuments?: readonly DatedTerms[];
  totalExternalSources?: number;
  options?: CrossAnalysisOptions;
}

export interface CrossAnalysisOptions {
  /** Length of the "recent" window, in months. */
  windowMonths?: number;
  now?: Date;
  /** Minimum public occurrences before a theme can be called emerging. */
  minEmergingOccurrences?: number;
  /** Share of all observations above which a theme counts as dominant. */
  overrepresentedShare?: number;
  maxPerKind?: number;
}

export interface AnalysisInsight {
  kind: BrandInsightKind;
  title: string;
  summary: string;
  explanation: string;
  score: number;
  components: ScoreComponent[];
  evidence: InsightEvidence;
  internalEntryIds: string[];
  externalEntryIds: string[];
}

export interface CrossAnalysisResult {
  insights: AnalysisInsight[];
  stats: {
    internalCount: number;
    externalCount: number;
    observationCount: number;
    matchedInternal: number;
    windowStart: string;
  };
}

/** Cosine over real embeddings. Unrelated text sits well below `weak`. */
const EMBEDDING_THRESHOLDS = { strong: 0.58, moderate: 0.45, weak: 0.34 };
/** Word overlap. Lower across the board, because the scale is not the same. */
const LEXICAL_THRESHOLDS = { strong: 0.3, moderate: 0.2, weak: 0.12 };

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "is", "are",
  "be", "as", "that", "this", "it", "its", "our", "we", "their", "they", "by", "at",
  "from", "not", "but", "than", "then", "so", "very", "more", "most", "brand",
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "que", "qui",
  "nous", "notre", "nos", "leur", "leurs", "est", "sont", "pour", "dans", "sur",
  "avec", "plus", "marque", "au", "aux", "ce", "ces", "se", "sa", "son", "ses",
]);

/**
 * Axes along which a brand can say two incompatible things about itself.
 *
 * Cosine similarity cannot see a contradiction: "premium and exclusive" and
 * "accessible to everyone" are about the same subject and therefore *close*.
 * Detection needs an explicit notion of opposition, which is what this table
 * provides. It is deliberately small and readable; an LLM pass refines the
 * shortlist afterwards, but never invents the candidates.
 */
export const OPPOSITIONS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [
    ["premium", "luxury", "luxe", "exclusive", "exclusif", "high-end", "upscale", "haut de gamme", "elite"],
    ["accessible", "affordable", "abordable", "budget", "cheap", "everyone", "tous", "populaire", "entry-level", "inclusive"],
  ],
  [
    ["playful", "fun", "ludique", "irreverent", "cheeky", "joyful"],
    ["serious", "restrained", "sober", "sobre", "formal", "understated", "austere", "sérieux"],
  ],
  [
    ["local", "regional", "artisanal", "craft", "artisanale"],
    ["global", "international", "worldwide", "mass-market", "mondial"],
  ],
  [
    ["sustainable", "durable", "eco", "responsible", "responsable", "ethical", "circular"],
    ["disposable", "fast", "volume-driven", "jetable"],
  ],
  [
    ["heritage", "traditional", "timeless", "classic", "patrimoine", "traditionnel"],
    ["disruptive", "futuristic", "cutting-edge", "radical", "rupture"],
  ],
  [
    ["quiet", "discreet", "minimal", "understated", "discret", "minimaliste"],
    ["bold", "loud", "expressive", "maximalist", "audacieux"],
  ],
  [
    ["expert", "professional", "technical", "specialist"],
    ["beginner", "everyday", "casual", "amateur", "grand public"],
  ],
  [
    ["independent", "family-owned", "indépendant", "familiale"],
    ["corporate", "industrial", "industriel"],
  ],
];

function tokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

export function lexicalSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) {
    if (right.has(word)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

interface Similarity {
  value: number;
  mode: "EMBEDDING" | "LEXICAL";
}

export function claimSimilarity(internal: InternalClaim, external: ExternalTheme): Similarity {
  if (internal.embedding && external.embedding) {
    return { value: cosineSimilarity(internal.embedding, external.embedding), mode: "EMBEDDING" };
  }
  return {
    value: lexicalSimilarity(
      `${internal.title} ${internal.content}`,
      `${external.title} ${external.content} ${external.label}`,
    ),
    mode: "LEXICAL",
  };
}

function thresholds(mode: Similarity["mode"]) {
  return mode === "EMBEDDING" ? EMBEDDING_THRESHOLDS : LEXICAL_THRESHOLDS;
}

export interface Match {
  theme: ExternalTheme;
  similarity: number;
  mode: Similarity["mode"];
}

export function bestMatch(internal: InternalClaim, external: readonly ExternalTheme[]): Match | null {
  let best: Match | null = null;

  for (const theme of external) {
    const { value, mode } = claimSimilarity(internal, theme);
    if (!best || value > best.similarity) best = { theme, similarity: value, mode };
  }

  return best;
}

/** Diminishing returns: 3 sources is a lot more than 1, 30 is not much more than 20. */
function saturate(count: number, half: number): number {
  if (count <= 0) return 0;
  return count / (count + half);
}

/** Exponential decay on months since the last public occurrence. */
export function recencyScore(lastSeenAt: string | null, now: Date, halfLifeMonths = 12): number {
  if (!lastSeenAt) return 0;
  const time = Date.parse(lastSeenAt);
  if (!Number.isFinite(time)) return 0;

  const months = Math.max((now.getTime() - time) / (1000 * 60 * 60 * 24 * 30.44), 0);
  return Math.pow(0.5, months / halfLifeMonths);
}

/** Weighted mean of the components, with the weights normalised to sum to one. */
export function combineScore(components: readonly ScoreComponent[]): number {
  const total = components.reduce((sum, component) => sum + component.weight, 0);
  if (total === 0) return 0;

  const score = components.reduce(
    (sum, component) => sum + clamp01(component.value) * component.weight,
    0,
  );
  return Number((score / total).toFixed(4));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function component(name: string, value: number, weight: number, detail: string): ScoreComponent {
  return { name, value: Number(clamp01(value).toFixed(4)), weight, detail };
}

export interface PolarityConflict {
  axis: number;
  internalTerm: string;
  externalTerm: string;
}

/**
 * True when one text sits on one pole of an opposition and the other text sits
 * on the opposite pole — and neither text holds both poles at once, which is
 * how a brand describes a deliberate tension rather than a contradiction.
 */
export function polarityConflict(internalText: string, externalText: string): PolarityConflict | null {
  const left = internalText.toLowerCase();
  const right = externalText.toLowerCase();

  for (let axis = 0; axis < OPPOSITIONS.length; axis += 1) {
    const opposition = OPPOSITIONS[axis];
    if (!opposition) continue;
    const [poleA, poleB] = opposition;

    const leftA = poleA.find((term) => left.includes(term));
    const leftB = poleB.find((term) => left.includes(term));
    const rightA = poleA.find((term) => right.includes(term));
    const rightB = poleB.find((term) => right.includes(term));

    if (leftA && leftB) continue;
    if (rightA && rightB) continue;

    if (leftA && rightB) return { axis, internalTerm: leftA, externalTerm: rightB };
    if (leftB && rightA) return { axis, internalTerm: leftB, externalTerm: rightA };
  }

  return null;
}

function formatDate(value: string | null): string {
  if (!value) return "an unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function internalPriority(claim: InternalClaim): number {
  return claim.origin === "USER_EDITED" ? 1 : Math.max(claim.confidence, 0.2);
}

function trajectoryOf(
  trajectories: readonly ThemeTrajectory[],
  entryId: string,
): ThemeTrajectory | null {
  return trajectories.find((trajectory) => trajectory.entryId === entryId) ?? null;
}

export function runCrossAnalysis(input: CrossAnalysisInput): CrossAnalysisResult {
  const options = input.options ?? {};
  const now = options.now ?? new Date();
  const windowMonths = options.windowMonths ?? 12;
  const cutoff = windowStart(now, windowMonths);
  const maxPerKind = options.maxPerKind ?? 8;

  const trajectories = themeTrajectories(input.observations, { windowMonths, now, granularity: "QUARTER" });
  const totalSources = input.totalExternalSources ?? new Set(input.observations.map((point) => point.sourceId)).size;

  const insights: AnalysisInsight[] = [];
  let matchedInternal = 0;

  for (const claim of input.internal) {
    const match = bestMatch(claim, input.external);
    const limits = thresholds(match?.mode ?? "LEXICAL");

    if (match && match.similarity >= limits.moderate) matchedInternal += 1;

    insights.push(
      ...alignmentInsights(claim, match, limits, trajectories, now, totalSources),
    );
    insights.push(...contradictionInsights(claim, input.external, trajectories, now));
  }

  insights.push(
    ...emergingInsights(input, trajectories, now, options),
    ...overrepresentedInsights(input, trajectories, now, options),
  );

  const toneInsight = toneDriftInsight(input.toneDocuments ?? [], cutoff, now);
  if (toneInsight) insights.push(toneInsight);

  const positioningInsight = positioningEvolutionInsight(input, cutoff, now);
  if (positioningInsight) insights.push(positioningInsight);

  return {
    insights: capPerKind(insights.sort((a, b) => b.score - a.score), maxPerKind),
    stats: {
      internalCount: input.internal.length,
      externalCount: input.external.length,
      observationCount: input.observations.length,
      matchedInternal,
      windowStart: cutoff.toISOString(),
    },
  };
}

function capPerKind(insights: readonly AnalysisInsight[], maxPerKind: number): AnalysisInsight[] {
  const counts = new Map<BrandInsightKind, number>();
  const kept: AnalysisInsight[] = [];

  for (const insight of insights) {
    const count = counts.get(insight.kind) ?? 0;
    if (count >= maxPerKind) continue;
    counts.set(insight.kind, count + 1);
    kept.push(insight);
  }

  return kept;
}

/**
 * ALIGNED / MISSING_EXTERNAL / DRIFT / FORGOTTEN — the four states an internal
 * claim can be in relative to what was actually published.
 */
function alignmentInsights(
  claim: InternalClaim,
  match: Match | null,
  limits: { strong: number; moderate: number; weak: number },
  trajectories: readonly ThemeTrajectory[],
  now: Date,
  totalSources: number,
): AnalysisInsight[] {
  if (!match || match.similarity < limits.weak) {
    const components = [
      component("semantic similarity", match ? 1 - match.similarity / limits.weak : 1, 0.4,
        match
          ? `no public theme comes closer than ${percent(match.similarity)} to this claim`
          : "no public themes have been extracted yet"),
      component("internal priority", internalPriority(claim), 0.4,
        claim.origin === "USER_EDITED" ? "a person wrote this entry" : `extraction confidence ${percent(claim.confidence)}`),
      component("source diversity", saturate(totalSources, 6), 0.2, `${plural(totalSources, "public source")} analysed`),
    ];

    return [
      {
        kind: "MISSING_EXTERNAL",
        title: claim.title,
        summary: `"${claim.title}" does not appear in any public communication analysed.`,
        explanation:
          `The internal memory holds "${claim.title}" — ${truncate(claim.content, 140)} — but nothing in ` +
          `${plural(totalSources, "analysed public content", "analysed public contents")} carries it. ` +
          (match
            ? `The closest public theme is "${match.theme.label}" at ${percent(match.similarity)} similarity, below the ${percent(limits.weak)} floor.`
            : "No public themes have been extracted yet."),
        score: combineScore(components),
        components,
        evidence: {
          externalSources: totalSources,
          similarity: match ? Number(match.similarity.toFixed(4)) : 0,
          internalTitles: [claim.title],
          externalLabels: match ? [match.theme.label] : [],
        },
        internalEntryIds: [claim.id],
        externalEntryIds: [],
      },
    ];
  }

  if (match.similarity < limits.moderate) return [];

  const trajectory = trajectoryOf(trajectories, match.theme.id);
  const theme = match.theme;

  const shared: ScoreComponent[] = [
    component("semantic similarity", match.similarity, 0.3, `${percent(match.similarity)} match with "${theme.label}"`),
    component("frequency", saturate(theme.occurrenceCount, 5), 0.2, `${plural(theme.occurrenceCount, "public occurrence")}`),
    component("source diversity", saturate(theme.sourceCount, 3), 0.2, `${plural(theme.sourceCount, "distinct source")}`),
    component("internal priority", internalPriority(claim), 0.15,
      claim.origin === "USER_EDITED" ? "a person wrote this entry" : `extraction confidence ${percent(claim.confidence)}`),
  ];

  if (trajectory?.trend === "DORMANT" && trajectory.earlierCount >= 2) {
    const components = [
      ...shared,
      component("recency", 1 - recencyScore(theme.lastSeenAt, now), 0.15, `last said publicly in ${formatDate(theme.lastSeenAt)}`),
    ];

    return [
      {
        kind: "FORGOTTEN",
        title: claim.title,
        summary: `"${claim.title}" was communicated ${plural(trajectory.earlierCount, "time")} and has gone quiet.`,
        explanation:
          `"${theme.label}" carried this message across ${plural(trajectory.earlierCount, "public content", "public contents")} ` +
          `from ${plural(theme.sourceCount, "source")}, first in ${formatDate(theme.firstSeenAt)} and last in ${formatDate(theme.lastSeenAt)}. ` +
          `It has not appeared in the last ${monthsBetween(theme.lastSeenAt, now)} months, while the internal memory still holds it as "${claim.title}".`,
        score: combineScore(components),
        components,
        evidence: {
          externalOccurrences: theme.occurrenceCount,
          externalSources: theme.sourceCount,
          firstSeenAt: theme.firstSeenAt,
          lastSeenAt: theme.lastSeenAt,
          earlierOccurrences: trajectory.earlierCount,
          recentOccurrences: 0,
          similarity: Number(match.similarity.toFixed(4)),
          internalTitles: [claim.title],
          externalLabels: [theme.label],
          periods: trajectory.buckets.map((bucket) => ({ period: bucket.period, count: bucket.count })),
        },
        internalEntryIds: [claim.id],
        externalEntryIds: [theme.id],
      },
    ];
  }

  if (trajectory?.trend === "FALLING") {
    const components = [
      ...shared,
      component("recency", 1 - recencyScore(theme.lastSeenAt, now), 0.15, `weakening since ${formatDate(theme.lastSeenAt)}`),
    ];

    return [
      {
        kind: "DRIFT",
        title: claim.title,
        summary: `"${claim.title}" is communicated less than it used to be.`,
        explanation:
          `"${theme.label}" appeared ${plural(trajectory.earlierCount, "time")} before the last 12 months and ` +
          `${plural(trajectory.recentCount, "time")} since. The internal memory still treats "${claim.title}" as current.`,
        score: combineScore(components),
        components,
        evidence: {
          externalOccurrences: theme.occurrenceCount,
          externalSources: theme.sourceCount,
          recentOccurrences: trajectory.recentCount,
          earlierOccurrences: trajectory.earlierCount,
          firstSeenAt: theme.firstSeenAt,
          lastSeenAt: theme.lastSeenAt,
          similarity: Number(match.similarity.toFixed(4)),
          internalTitles: [claim.title],
          externalLabels: [theme.label],
          periods: trajectory.buckets.map((bucket) => ({ period: bucket.period, count: bucket.count })),
        },
        internalEntryIds: [claim.id],
        externalEntryIds: [theme.id],
      },
    ];
  }

  const components = [
    ...shared,
    component("recency", recencyScore(theme.lastSeenAt, now), 0.15, `last said publicly in ${formatDate(theme.lastSeenAt)}`),
  ];

  return [
    {
      kind: "ALIGNED",
      title: claim.title,
      summary: `"${claim.title}" is backed by public communication.`,
      explanation:
        `"${theme.label}" matches this internal claim at ${percent(match.similarity)} and appears in ` +
        `${plural(theme.occurrenceCount, "public content", "public contents")} from ${plural(theme.sourceCount, "source")}, ` +
        `between ${formatDate(theme.firstSeenAt)} and ${formatDate(theme.lastSeenAt)}.`,
      score: combineScore(components),
      components,
      evidence: {
        externalOccurrences: theme.occurrenceCount,
        externalSources: theme.sourceCount,
        firstSeenAt: theme.firstSeenAt,
        lastSeenAt: theme.lastSeenAt,
        recentOccurrences: trajectory?.recentCount ?? 0,
        similarity: Number(match.similarity.toFixed(4)),
        internalTitles: [claim.title],
        externalLabels: [theme.label],
      },
      internalEntryIds: [claim.id],
      externalEntryIds: [theme.id],
    },
  ];
}

function contradictionInsights(
  claim: InternalClaim,
  external: readonly ExternalTheme[],
  trajectories: readonly ThemeTrajectory[],
  now: Date,
): AnalysisInsight[] {
  const internalText = `${claim.title} ${claim.content}`;
  const found: AnalysisInsight[] = [];

  for (const theme of external) {
    const externalText = `${theme.label} ${theme.title} ${theme.content}`;
    const conflict = polarityConflict(internalText, externalText);
    if (!conflict) continue;

    const { value: similarity, mode } = claimSimilarity(claim, theme);
    // The opposition already anchors the pair to a shared axis; a low floor
    // keeps genuinely unrelated pairs out without demanding closeness that a
    // contradiction, by construction, will not have.
    if (similarity < thresholds(mode).weak * 0.6) continue;

    const trajectory = trajectoryOf(trajectories, theme.id);
    const components = [
      component("frequency", saturate(theme.occurrenceCount, 4), 0.3, `${plural(theme.occurrenceCount, "public occurrence")}`),
      component("source diversity", saturate(theme.sourceCount, 3), 0.2, `${plural(theme.sourceCount, "distinct source")}`),
      component("recency", recencyScore(theme.lastSeenAt, now), 0.2, `last said publicly in ${formatDate(theme.lastSeenAt)}`),
      component("internal priority", internalPriority(claim), 0.2,
        claim.origin === "USER_EDITED" ? "a person wrote this entry" : `extraction confidence ${percent(claim.confidence)}`),
      component("topical proximity", similarity, 0.1, `${percent(similarity)} similarity on the same subject`),
    ];

    found.push({
      kind: "CONTRADICTION",
      title: `${claim.title} vs "${theme.label}"`,
      summary: `Internally "${conflict.internalTerm}", publicly "${conflict.externalTerm}".`,
      explanation:
        `The internal memory says "${truncate(claim.content, 120)}" (${conflict.internalTerm}), while ` +
        `${plural(theme.occurrenceCount, "public content", "public contents")} from ${plural(theme.sourceCount, "source")} ` +
        `say "${truncate(theme.content, 120)}" (${conflict.externalTerm}). ` +
        `These sit on opposite ends of the same axis, so one of them is out of date.`,
      score: combineScore(components),
      components,
      evidence: {
        externalOccurrences: theme.occurrenceCount,
        externalSources: theme.sourceCount,
        firstSeenAt: theme.firstSeenAt,
        lastSeenAt: theme.lastSeenAt,
        recentOccurrences: trajectory?.recentCount ?? 0,
        similarity: Number(similarity.toFixed(4)),
        internalTitles: [claim.title],
        externalLabels: [theme.label],
      },
      internalEntryIds: [claim.id],
      externalEntryIds: [theme.id],
    });
  }

  return found;
}

function emergingInsights(
  input: CrossAnalysisInput,
  trajectories: readonly ThemeTrajectory[],
  now: Date,
  options: CrossAnalysisOptions,
): AnalysisInsight[] {
  const minOccurrences = options.minEmergingOccurrences ?? 3;
  const found: AnalysisInsight[] = [];

  for (const theme of input.external) {
    const trajectory = trajectoryOf(trajectories, theme.id);
    if (!trajectory) continue;
    if (trajectory.trend !== "NEW" && trajectory.trend !== "RISING") continue;
    if (trajectory.recentCount < minOccurrences || theme.sourceCount < 2) continue;

    const closest = closestInternal(theme, input.internal);
    const limits = thresholds(closest?.mode ?? "LEXICAL");
    if (closest && closest.similarity >= limits.moderate) continue;

    const components = [
      component("frequency", saturate(trajectory.recentCount, 4), 0.3, `${plural(trajectory.recentCount, "occurrence")} in the last 12 months`),
      component("source diversity", saturate(theme.sourceCount, 3), 0.25, `${plural(theme.sourceCount, "distinct source")}`),
      component("recency", recencyScore(theme.lastSeenAt, now), 0.2, `last said publicly in ${formatDate(theme.lastSeenAt)}`),
      component("internal coverage", closest ? 1 - closest.similarity / Math.max(limits.moderate, 0.01) : 1, 0.15,
        closest
          ? `the closest internal entry, "${closest.claim.title}", matches at only ${percent(closest.similarity)}`
          : "no internal entry covers this"),
      component("confidence", theme.confidence, 0.1, `extraction confidence ${percent(theme.confidence)}`),
    ];

    found.push({
      kind: "EMERGING",
      title: theme.label,
      summary: `"${theme.label}" is rising in public communication with no internal counterpart.`,
      explanation:
        `"${theme.label}" appears in ${plural(trajectory.recentCount, "content", "contents")} from ` +
        `${plural(theme.sourceCount, "source")} since ${formatDate(theme.firstSeenAt)}` +
        (trajectory.earlierCount > 0 ? `, against ${plural(trajectory.earlierCount, "occurrence")} before that` : "") +
        `, while the internal memory ` +
        (closest
          ? `holds nothing closer than "${closest.claim.title}" at ${percent(closest.similarity)}.`
          : "has no entry on it at all."),
      score: combineScore(components),
      components,
      evidence: {
        externalOccurrences: theme.occurrenceCount,
        externalSources: theme.sourceCount,
        recentOccurrences: trajectory.recentCount,
        earlierOccurrences: trajectory.earlierCount,
        firstSeenAt: theme.firstSeenAt,
        lastSeenAt: theme.lastSeenAt,
        similarity: closest ? Number(closest.similarity.toFixed(4)) : 0,
        internalTitles: closest ? [closest.claim.title] : [],
        externalLabels: [theme.label],
        periods: trajectory.buckets.map((bucket) => ({ period: bucket.period, count: bucket.count })),
      },
      internalEntryIds: [],
      externalEntryIds: [theme.id],
    });
  }

  return found;
}

function overrepresentedInsights(
  input: CrossAnalysisInput,
  trajectories: readonly ThemeTrajectory[],
  now: Date,
  options: CrossAnalysisOptions,
): AnalysisInsight[] {
  const shareFloor = options.overrepresentedShare ?? 0.12;
  const total = input.observations.length;
  if (total === 0) return [];

  const found: AnalysisInsight[] = [];

  for (const theme of input.external) {
    const share = theme.occurrenceCount / total;
    if (share < shareFloor || theme.sourceCount < 2) continue;

    const closest = closestInternal(theme, input.internal);
    const limits = thresholds(closest?.mode ?? "LEXICAL");
    // Strongly covered internally: that is alignment, not overrepresentation.
    if (closest && closest.similarity >= limits.strong) continue;

    const trajectory = trajectoryOf(trajectories, theme.id);
    const components = [
      component("share of public communication", share, 0.35, `${percent(share)} of all public statements`),
      component("frequency", saturate(theme.occurrenceCount, 5), 0.2, `${plural(theme.occurrenceCount, "occurrence")}`),
      component("source diversity", saturate(theme.sourceCount, 3), 0.2, `${plural(theme.sourceCount, "distinct source")}`),
      component("internal coverage", closest ? 1 - closest.similarity / Math.max(limits.strong, 0.01) : 1, 0.25,
        closest ? `best internal match ${percent(closest.similarity)}` : "no internal entry covers this"),
    ];

    found.push({
      kind: "OVERREPRESENTED",
      title: theme.label,
      summary: `"${theme.label}" carries ${percent(share)} of public communication but is thin in the brand memory.`,
      explanation:
        `"${theme.label}" accounts for ${percent(share)} of all public statements analysed ` +
        `(${plural(theme.occurrenceCount, "occurrence")} across ${plural(theme.sourceCount, "source")}), ` +
        (closest
          ? `while the internal memory's closest entry, "${closest.claim.title}", matches at only ${percent(closest.similarity)}.`
          : "while the internal memory has no entry on it."),
      score: combineScore(components),
      components,
      evidence: {
        externalOccurrences: theme.occurrenceCount,
        externalSources: theme.sourceCount,
        share: Number(share.toFixed(4)),
        firstSeenAt: theme.firstSeenAt,
        lastSeenAt: theme.lastSeenAt,
        recentOccurrences: trajectory?.recentCount ?? 0,
        similarity: closest ? Number(closest.similarity.toFixed(4)) : 0,
        internalTitles: closest ? [closest.claim.title] : [],
        externalLabels: [theme.label],
      },
      internalEntryIds: closest ? [closest.claim.id] : [],
      externalEntryIds: [theme.id],
    });
  }

  return found;
}

interface ClosestInternal {
  claim: InternalClaim;
  similarity: number;
  mode: Similarity["mode"];
}

function closestInternal(
  theme: ExternalTheme,
  internal: readonly InternalClaim[],
): ClosestInternal | null {
  let best: ClosestInternal | null = null;

  for (const claim of internal) {
    const { value, mode } = claimSimilarity(claim, theme);
    if (!best || value > best.similarity) best = { claim, similarity: value, mode };
  }

  return best;
}

const TONE_DRIFT_FLOOR = 0.25;
const MIN_TONE_DOCUMENTS = 4;

function toneDriftInsight(
  toneDocuments: readonly DatedTerms[],
  cutoff: Date,
  now: Date,
): AnalysisInsight | null {
  const earlier = toneDocuments.filter((document) => Date.parse(document.at) < cutoff.getTime());
  const recent = toneDocuments.filter((document) => Date.parse(document.at) >= cutoff.getTime());

  if (earlier.length < MIN_TONE_DOCUMENTS || recent.length < MIN_TONE_DOCUMENTS) return null;

  const shifts = termShift(toneDocuments, cutoff);
  const distance = distributionDistance(shifts);
  if (distance < TONE_DRIFT_FLOOR) return null;

  const movers = shifts.filter((shift) => Math.abs(shift.delta) >= 0.15).slice(0, 6);
  if (movers.length === 0) return null;

  const components = [
    component("distribution distance", distance, 0.5, `${percent(distance)} of the tone distribution moved`),
    component("sample size", saturate(Math.min(earlier.length, recent.length), 6), 0.3,
      `${earlier.length} earlier and ${recent.length} recent contents`),
    component("consistency of the shift", saturate(movers.length, 3), 0.2, `${plural(movers.length, "tone word")} moved materially`),
  ];

  return {
    kind: "TONE_DRIFT",
    title: "The public tone has shifted",
    summary: describeToneShift(movers),
    explanation:
      `Comparing ${plural(earlier.length, "content", "contents")} published before ${formatDate(cutoff.toISOString())} with ` +
      `${plural(recent.length, "content", "contents")} since: ` +
      movers
        .map((shift) => `"${shift.term}" ${percent(shift.earlier)} → ${percent(shift.recent)}`)
        .join(", ") +
      `. Overall ${percent(distance)} of the tone distribution changed.`,
    score: combineScore(components),
    components,
    evidence: {
      terms: movers.map((shift) => ({
        term: shift.term,
        earlier: Number(shift.earlier.toFixed(4)),
        recent: Number(shift.recent.toFixed(4)),
      })),
      firstSeenAt: earlier[0]?.at ?? null,
      lastSeenAt: recent[recent.length - 1]?.at ?? now.toISOString(),
    },
    internalEntryIds: [],
    externalEntryIds: [],
  };
}

function describeToneShift(movers: readonly TermShift[]): string {
  const rising = movers.filter((shift) => shift.delta > 0).map((shift) => shift.term);
  const falling = movers.filter((shift) => shift.delta < 0).map((shift) => shift.term);

  const parts: string[] = [];
  if (falling.length > 0) parts.push(`less ${falling.slice(0, 3).join(", ")}`);
  if (rising.length > 0) parts.push(`more ${rising.slice(0, 3).join(", ")}`);
  return parts.join(" and ") || "The tone distribution moved.";
}

const POSITIONING_KINDS: ReadonlySet<ExternalMemoryKind> = new Set([
  "POSITIONING",
  "MESSAGE",
  "CLAIM",
  "STRATEGIC_THEME",
  "IDENTITY",
]);

function positioningEvolutionInsight(
  input: CrossAnalysisInput,
  cutoff: Date,
  now: Date,
): AnalysisInsight | null {
  const kindByEntry = new Map(input.external.map((theme) => [theme.id, theme.kind]));
  const relevant = input.observations.filter((point) => {
    const kind = kindByEntry.get(point.entryId);
    return kind !== undefined && POSITIONING_KINDS.has(kind);
  });

  const earlier = relevant.filter((point) => Date.parse(point.observedAt) < cutoff.getTime());
  const recent = relevant.filter((point) => Date.parse(point.observedAt) >= cutoff.getTime());
  if (earlier.length < 4 || recent.length < 4) return null;

  const earlierTop = topLabels(earlier, 3);
  const recentTop = topLabels(recent, 3);
  if (earlierTop.length === 0 || recentTop.length === 0) return null;

  const shared = earlierTop.filter((label) => recentTop.includes(label));
  const overlap = shared.length / new Set([...earlierTop, ...recentTop]).size;
  if (overlap >= 0.5) return null;

  const components = [
    component("change in dominant themes", 1 - overlap, 0.5, `${shared.length} of ${earlierTop.length} leading themes survived`),
    component("sample size", saturate(Math.min(earlier.length, recent.length), 8), 0.3,
      `${earlier.length} earlier and ${recent.length} recent positioning statements`),
    component("recency", recencyScore(recent[recent.length - 1]?.observedAt ?? null, now), 0.2, "measured against the last 12 months"),
  ];

  return {
    kind: "POSITIONING_EVOLUTION",
    title: "External positioning has moved",
    summary: `From ${earlierTop.join(" + ")} to ${recentTop.join(" + ")}.`,
    explanation:
      `Before ${formatDate(cutoff.toISOString())}, public positioning statements were led by ${earlierTop.join(", ")} ` +
      `(${plural(earlier.length, "statement")}). Since then they are led by ${recentTop.join(", ")} ` +
      `(${plural(recent.length, "statement")}). ` +
      (shared.length > 0 ? `${shared.join(", ")} carried across both periods.` : "No leading theme carried across both periods."),
    score: combineScore(components),
    components,
    evidence: {
      externalLabels: [...new Set([...earlierTop, ...recentTop])],
      earlierOccurrences: earlier.length,
      recentOccurrences: recent.length,
      periods: [
        { period: `before ${periodKey(cutoff.toISOString(), "MONTH")}`, count: earlier.length },
        { period: `since ${periodKey(cutoff.toISOString(), "MONTH")}`, count: recent.length },
      ],
    },
    internalEntryIds: [],
    externalEntryIds: [],
  };
}

function topLabels(points: readonly ObservationPoint[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.label, (counts.get(point.label) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
}

function monthsBetween(from: string | null, to: Date): number {
  if (!from) return 0;
  const time = Date.parse(from);
  if (!Number.isFinite(time)) return 0;
  return Math.max(Math.round((to.getTime() - time) / (1000 * 60 * 60 * 24 * 30.44)), 0);
}

function truncate(text: string, length: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= length ? clean : `${clean.slice(0, length - 1)}…`;
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}
