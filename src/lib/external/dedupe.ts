import { createHash } from "node:crypto";
import type { DuplicateKind, ExternalMediaClass, ExternalSourceType } from "@/types/external";

/**
 * The same announcement reaches this system many times: on the brand's
 * newsroom, in nine outlets that ran the release, and again under a URL with
 * different tracking parameters. Collapsing all of that into "one thing said
 * once" would be wrong — nine outlets running a release is a real signal — but
 * so would counting nine copies as nine independent messages.
 *
 * So duplication is classified rather than merged, and the classification is
 * kept on the source row:
 *
 *   IDENTICAL       the same document, reached twice
 *   NEAR_DUPLICATE  the same text with trivial differences (a reprint, a /amp copy)
 *   SYNDICATED      an outlet running the brand's release, largely verbatim
 *   DISTINCT        genuinely different content
 *
 * IDENTICAL and NEAR_DUPLICATE are withheld from retrieval and from theme
 * counting. SYNDICATED is kept: it is how you measure pick-up.
 */

/**
 * The three bands, measured on five-word shingle overlap.
 *
 * Calibrated against the fixtures in tests/fixtures/external, which are a real
 * shape of the problem: a release and the same release with one line added
 * overlap 0.97; a release and an outlet's write-up of it, sharing two verbatim
 * paragraphs, overlap 0.32; a release and an unrelated page from the same brand
 * overlap 0.00. Unrelated content sits near zero, which is what leaves room for
 * a syndication band this low.
 */
/** Above this, the two texts are the same document. */
export const IDENTICAL_THRESHOLD = 0.9;
/** Above this, one text is an edit of the other rather than a new piece. */
export const NEAR_DUPLICATE_THRESHOLD = 0.6;
/** Above this, one text carries significant verbatim material from the other. */
export const SYNDICATION_THRESHOLD = 0.25;

const SHINGLE_SIZE = 5;

export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Stable identity for a body of text, insensitive to formatting and accents. */
export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeForComparison(text)).digest("hex");
}

export function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = normalizeForComparison(text).split(" ").filter(Boolean);
  const result = new Set<string>();

  if (words.length === 0) return result;
  if (words.length <= size) {
    result.add(words.join(" "));
    return result;
  }

  for (let index = 0; index + size <= words.length; index += 1) {
    result.add(words.slice(index, index + size).join(" "));
  }
  return result;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Lexical overlap, 0..1. Word-level shingles, so reordering costs similarity. */
export function textSimilarity(a: string, b: string): number {
  return jaccard(shingles(a), shingles(b));
}

export interface DuplicateCandidate {
  sourceId: string;
  canonicalUrl: string | null;
  contentHash: string | null;
  text: string;
  publisher: string | null;
  sourceType: ExternalSourceType;
  mediaClass: ExternalMediaClass;
  publishedAt: string | null;
}

export interface DuplicateVerdict {
  kind: DuplicateKind;
  similarity: number;
  /** Why this verdict, in words the sources screen can show as-is. */
  reason: string;
  matchedSourceId: string | null;
}

const DISTINCT: DuplicateVerdict = {
  kind: "DISTINCT",
  similarity: 0,
  reason: "No existing content matches this closely.",
  matchedSourceId: null,
};

function samePublisher(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function publishedBefore(candidate: string | null, existing: string | null): boolean {
  if (!candidate || !existing) return false;
  return Date.parse(existing) <= Date.parse(candidate);
}

/**
 * Compares one newly fetched content against one we already hold.
 *
 * `semanticSimilarity` is the cosine of the two embeddings when both are
 * available. It carries the cases lexical overlap misses — a rewritten lead on
 * the same announcement — and is deliberately weighted below the lexical score,
 * which is the one that can tell a copy from a topic.
 */
export function classifyDuplicate(
  candidate: DuplicateCandidate,
  existing: DuplicateCandidate,
  semanticSimilarity: number | null = null,
): DuplicateVerdict {
  if (candidate.sourceId === existing.sourceId) return DISTINCT;

  if (
    candidate.canonicalUrl &&
    existing.canonicalUrl &&
    candidate.canonicalUrl === existing.canonicalUrl
  ) {
    return {
      kind: "IDENTICAL",
      similarity: 1,
      reason: "Both URLs declare the same canonical page.",
      matchedSourceId: existing.sourceId,
    };
  }

  if (candidate.contentHash && existing.contentHash && candidate.contentHash === existing.contentHash) {
    return {
      kind: "IDENTICAL",
      similarity: 1,
      reason: "The text is byte-for-byte the same once formatting is ignored.",
      matchedSourceId: existing.sourceId,
    };
  }

  const lexical = textSimilarity(candidate.text, existing.text);
  const similarity =
    semanticSimilarity === null ? lexical : Math.max(lexical, (lexical + semanticSimilarity) / 2);

  if (similarity >= IDENTICAL_THRESHOLD) {
    return {
      kind: "IDENTICAL",
      similarity,
      reason: `The text is ${percent(similarity)} identical to content already stored.`,
      matchedSourceId: existing.sourceId,
    };
  }

  const differentPublisher = !samePublisher(candidate.publisher, existing.publisher);

  if (similarity >= NEAR_DUPLICATE_THRESHOLD) {
    if (differentPublisher) {
      return {
        kind: "SYNDICATED",
        similarity,
        reason: `${candidate.publisher ?? "Another outlet"} ran ${percent(similarity)} of the same text as ${existing.publisher ?? "an existing source"}.`,
        matchedSourceId: existing.sourceId,
      };
    }
    return {
      kind: "NEAR_DUPLICATE",
      similarity,
      reason: `The same publisher already has ${percent(similarity)} of this text.`,
      matchedSourceId: existing.sourceId,
    };
  }

  // An outlet writing up a release the brand put out first: lower overlap,
  // different publisher, and the brand's own version came first.
  const originIsBrandMaterial =
    existing.mediaClass === "OWNED" || existing.sourceType === "PRESS_RELEASE";

  if (
    similarity >= SYNDICATION_THRESHOLD &&
    differentPublisher &&
    originIsBrandMaterial &&
    candidate.mediaClass !== "OWNED" &&
    publishedBefore(candidate.publishedAt, existing.publishedAt)
  ) {
    return {
      kind: "SYNDICATED",
      similarity,
      reason: `${candidate.publisher ?? "This outlet"} appears to be covering an earlier release by ${existing.publisher ?? "the brand"} (${percent(similarity)} overlap).`,
      matchedSourceId: existing.sourceId,
    };
  }

  return { ...DISTINCT, similarity, matchedSourceId: null };
}

/** The strongest verdict across everything already stored for the brand. */
export function findDuplicate(
  candidate: DuplicateCandidate,
  existing: readonly DuplicateCandidate[],
  semanticSimilarity: (other: DuplicateCandidate) => number | null = () => null,
): DuplicateVerdict {
  const ranked: DuplicateKind[] = ["DISTINCT", "SYNDICATED", "NEAR_DUPLICATE", "IDENTICAL"];
  let best = DISTINCT;

  for (const other of existing) {
    const verdict = classifyDuplicate(candidate, other, semanticSimilarity(other));
    const better =
      ranked.indexOf(verdict.kind) > ranked.indexOf(best.kind) ||
      (verdict.kind === best.kind && verdict.similarity > best.similarity);
    if (better) best = verdict;
  }

  return best;
}

/** IDENTICAL and NEAR_DUPLICATE never re-enter retrieval or theme counting. */
export function suppressesContent(kind: DuplicateKind): boolean {
  return kind === "IDENTICAL" || kind === "NEAR_DUPLICATE";
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
