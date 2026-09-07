/**
 * External Brand Memory domain types.
 *
 * The internal memory records what the brand says it is. These types record
 * what it has actually published, and are shaped so that every claim keeps its
 * date: a theme is an aggregate over dated observations, never a static blob.
 */

export const EXTERNAL_CONNECTOR_KINDS = ["URL", "SITEMAP", "RSS", "CRAWL"] as const;
export type ExternalConnectorKind = (typeof EXTERNAL_CONNECTOR_KINDS)[number];

export const EXTERNAL_SYNC_FREQUENCIES = ["MANUAL", "DAILY", "WEEKLY"] as const;
export type ExternalSyncFrequency = (typeof EXTERNAL_SYNC_FREQUENCIES)[number];

export const EXTERNAL_SOURCE_TYPES = [
  "PRESS_RELEASE",
  "ARTICLE",
  "INTERVIEW",
  "WEB_PAGE",
  "BLOG_POST",
  "NEWSROOM",
  "VIDEO",
  "SOCIAL_POST",
  "MANUAL",
  "OTHER",
] as const;
export type ExternalSourceType = (typeof EXTERNAL_SOURCE_TYPES)[number];

export const EXTERNAL_STATUSES = [
  "DISCOVERED",
  "FETCHING",
  "PROCESSING",
  "READY",
  "FAILED",
  "DUPLICATE",
] as const;
export type ExternalStatus = (typeof EXTERNAL_STATUSES)[number];

export const EXTERNAL_MEDIA_CLASSES = ["OWNED", "EARNED", "UNKNOWN"] as const;
export type ExternalMediaClass = (typeof EXTERNAL_MEDIA_CLASSES)[number];

export const EXTERNAL_MEMORY_KINDS = [
  "IDENTITY",
  "POSITIONING",
  "AUDIENCE",
  "PERSONALITY",
  "VOICE",
  "VALUES",
  "PRODUCT",
  "SERVICE",
  "MESSAGE",
  "CLAIM",
  "TOPIC",
  "NARRATIVE",
  "SPOKESPERSON",
  "CREATIVE_THEME",
  "STRATEGIC_THEME",
] as const;
export type ExternalMemoryKind = (typeof EXTERNAL_MEMORY_KINDS)[number];

export const BRAND_INSIGHT_KINDS = [
  "ALIGNED",
  "CONTRADICTION",
  "DRIFT",
  "EMERGING",
  "OVERREPRESENTED",
  "MISSING_EXTERNAL",
  "FORGOTTEN",
  "TONE_DRIFT",
  "POSITIONING_EVOLUTION",
] as const;
export type BrandInsightKind = (typeof BRAND_INSIGHT_KINDS)[number];

export const DUPLICATE_KINDS = [
  "IDENTICAL",
  "NEAR_DUPLICATE",
  "SYNDICATED",
  "DISTINCT",
] as const;
export type DuplicateKind = (typeof DUPLICATE_KINDS)[number];

export interface ExternalFeed {
  id: string;
  brandId: string;
  kind: ExternalConnectorKind;
  url: string;
  label: string;
  enabled: boolean;
  frequency: ExternalSyncFrequency;
  maxDocuments: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  discoveredCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalSource {
  id: string;
  brandId: string;
  feedId: string | null;
  sourceType: ExternalSourceType;
  mediaClass: ExternalMediaClass;
  url: string;
  canonicalUrl: string | null;
  urlHash: string;
  contentHash: string | null;
  status: ExternalStatus;
  extractionError: string | null;
  duplicateOf: string | null;
  duplicateKind: DuplicateKind | null;
  duplicateSimilarity: number | null;
  discoveredAt: string;
  fetchedAt: string | null;
  processedAt: string | null;
  chunkCount: number;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalContent {
  id: string;
  brandId: string;
  sourceId: string;
  title: string;
  body: string;
  summary: string;
  author: string | null;
  publisher: string | null;
  publishedAt: string | null;
  language: string | null;
  tone: string[];
  narrative: string;
  wordCount: number;
  extractedAt: string;
}

/** A source row joined with the headline fields of its content, for listings. */
export interface ExternalSourceListItem extends ExternalSource {
  title: string;
  publisher: string | null;
  author: string | null;
  publishedAt: string | null;
  summary: string;
  themes: string[];
}

export interface ExternalMemoryEntry {
  id: string;
  brandId: string;
  kind: ExternalMemoryKind;
  /** Normalised theme key. Unique per brand and kind. */
  label: string;
  title: string;
  content: string;
  confidence: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurrenceCount: number;
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalObservation {
  id: string;
  entryId: string;
  sourceId: string;
  statement: string;
  excerpt: string;
  confidence: number;
  observedAt: string;
}

export interface ScoreComponent {
  name: string;
  /** 0..1 */
  value: number;
  /** 0..1, sums to 1 across an insight's components. */
  weight: number;
  detail: string;
}

export interface BrandInsight {
  id: string;
  brandId: string;
  kind: BrandInsightKind;
  title: string;
  summary: string;
  explanation: string;
  score: number;
  components: ScoreComponent[];
  evidence: InsightEvidence;
  internalEntryIds: string[];
  externalEntryIds: string[];
  judgedBy: "HEURISTIC" | "MODEL";
  computedAt: string;
}

export interface InsightEvidence {
  externalOccurrences?: number;
  externalSources?: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  recentOccurrences?: number;
  earlierOccurrences?: number;
  share?: number;
  similarity?: number;
  internalTitles?: string[];
  externalLabels?: string[];
  periods?: Array<{ period: string; count: number }>;
  terms?: Array<{ term: string; earlier: number; recent: number }>;
}

export interface ExternalAnalysisRun {
  id: string;
  brandId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  notes: string;
  insightCount: number;
  internalEntryCount: number;
  externalEntryCount: number;
  externalSourceCount: number;
  startedAt: string;
  finishedAt: string | null;
}

export const EXTERNAL_MEMORY_KIND_LABELS: Record<ExternalMemoryKind, string> = {
  IDENTITY: "Identity",
  POSITIONING: "Positioning",
  AUDIENCE: "Audience",
  PERSONALITY: "Personality",
  VOICE: "Voice",
  VALUES: "Values",
  PRODUCT: "Product",
  SERVICE: "Service",
  MESSAGE: "Message",
  CLAIM: "Claim",
  TOPIC: "Topic",
  NARRATIVE: "Narrative",
  SPOKESPERSON: "Spokesperson",
  CREATIVE_THEME: "Creative theme",
  STRATEGIC_THEME: "Strategic theme",
};

export const EXTERNAL_SOURCE_TYPE_LABELS: Record<ExternalSourceType, string> = {
  PRESS_RELEASE: "Press release",
  ARTICLE: "Article",
  INTERVIEW: "Interview",
  WEB_PAGE: "Web page",
  BLOG_POST: "Blog post",
  NEWSROOM: "Newsroom",
  VIDEO: "Video",
  SOCIAL_POST: "Social post",
  MANUAL: "Manual import",
  OTHER: "Other",
};

export const CONNECTOR_KIND_LABELS: Record<ExternalConnectorKind, string> = {
  URL: "Single URL",
  SITEMAP: "Sitemap",
  RSS: "RSS / Atom feed",
  CRAWL: "Site crawl",
};

export const INSIGHT_KIND_LABELS: Record<BrandInsightKind, string> = {
  ALIGNED: "Aligned",
  CONTRADICTION: "Contradiction",
  DRIFT: "Messaging drift",
  EMERGING: "Emerging externally",
  OVERREPRESENTED: "Overrepresented",
  MISSING_EXTERNAL: "Missing externally",
  FORGOTTEN: "Forgotten message",
  TONE_DRIFT: "Tone drift",
  POSITIONING_EVOLUTION: "Positioning evolution",
};

/** One-line statement of what each insight kind means, shown above each group. */
export const INSIGHT_KIND_DESCRIPTIONS: Record<BrandInsightKind, string> = {
  ALIGNED: "Internal memory and public communication say the same thing.",
  CONTRADICTION: "Internal memory and public communication disagree.",
  DRIFT: "An internal message was communicated before, but not recently.",
  EMERGING: "A theme is rising in public content with no internal counterpart.",
  OVERREPRESENTED: "A theme dominates public communication but barely exists internally.",
  MISSING_EXTERNAL: "An internal message has never reached public communication.",
  FORGOTTEN: "A message the brand once communicated has gone quiet.",
  TONE_DRIFT: "The tone of public communication has shifted over time.",
  POSITIONING_EVOLUTION: "External positioning has moved from one set of themes to another.",
};
