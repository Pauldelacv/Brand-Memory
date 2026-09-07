import { describe, expect, it } from "vitest";
import {
  classifyDuplicate,
  contentHash,
  findDuplicate,
  jaccard,
  shingles,
  suppressesContent,
  textSimilarity,
} from "@/lib/external/dedupe";
import type { DuplicateCandidate } from "@/lib/external/dedupe";
import { readPage } from "@/lib/external/html";
import { fixture } from "./fixtures/external";

const RELEASE_TEXT = readPage(fixture("press-release.html"), "https://www.velvire.com/newsroom/x").text;
const COVERAGE_TEXT = readPage(fixture("news-article.html"), "https://cyclingreview.example.com/x").text;
const BRAND_PAGE_TEXT = readPage(fixture("brand-page.html"), "https://www.velvire.com/atelier").text;

function candidate(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    sourceId: crypto.randomUUID(),
    canonicalUrl: null,
    contentHash: null,
    text: COVERAGE_TEXT,
    publisher: "The Cycling Review",
    sourceType: "ARTICLE",
    mediaClass: "EARNED",
    publishedAt: "2025-03-12T07:30:00.000Z",
    ...overrides,
  };
}

const release = candidate({
  sourceId: "release",
  text: RELEASE_TEXT,
  publisher: "Velvire",
  sourceType: "PRESS_RELEASE",
  mediaClass: "OWNED",
  publishedAt: "2025-03-11T09:00:00.000Z",
  canonicalUrl: "https://www.velvire.com/newsroom/repair-atelier-lyon",
  contentHash: contentHash(RELEASE_TEXT),
});

describe("text similarity", () => {
  it("is 1 for the same text and 0 for unrelated text", () => {
    expect(textSimilarity("the brand repairs every frame", "the brand repairs every frame")).toBe(1);
    expect(textSimilarity("the brand repairs every frame", "quarterly revenue rose")).toBe(0);
  });

  it("ignores punctuation, case and accents", () => {
    expect(contentHash("Durabilité: c'est notre raison d'être.")).toBe(
      contentHash("  durabilite   c est  notre raison d etre  "),
    );
  });

  it("builds overlapping word shingles", () => {
    expect(jaccard(shingles("a b c d e f", 5), shingles("a b c d e f", 5))).toBe(1);
  });
});

describe("duplicate classification", () => {
  it("calls the same canonical page identical", () => {
    const verdict = classifyDuplicate(
      candidate({ canonicalUrl: "https://www.velvire.com/newsroom/repair-atelier-lyon", text: BRAND_PAGE_TEXT }),
      release,
    );

    expect(verdict.kind).toBe("IDENTICAL");
    expect(verdict.matchedSourceId).toBe("release");
  });

  it("calls the same text identical even under a different URL", () => {
    const verdict = classifyDuplicate(
      candidate({ text: RELEASE_TEXT, contentHash: contentHash(RELEASE_TEXT) }),
      release,
    );

    expect(verdict.kind).toBe("IDENTICAL");
  });

  it("calls the same release with one line added the same document", () => {
    const verdict = classifyDuplicate(
      candidate({ text: `${RELEASE_TEXT} Media contact: press@velvire.com.`, publisher: "Velvire", mediaClass: "OWNED" }),
      candidate({ sourceId: "original", text: RELEASE_TEXT, publisher: "Velvire", mediaClass: "OWNED" }),
    );

    expect(verdict.kind).toBe("IDENTICAL");
  });

  it("calls an edited reprint by the same publisher a near duplicate", () => {
    // Two thirds of the release, re-published without the closing sections.
    const shortened = RELEASE_TEXT.split("\n\n").slice(0, 4).join("\n\n");

    const verdict = classifyDuplicate(
      candidate({ text: shortened, publisher: "Velvire", mediaClass: "OWNED", sourceType: "PRESS_RELEASE" }),
      candidate({ sourceId: "original", text: RELEASE_TEXT, publisher: "Velvire", mediaClass: "OWNED" }),
    );

    expect(verdict.kind).toBe("NEAR_DUPLICATE");
  });

  it("calls an outlet running the brand's release syndicated, not a duplicate", () => {
    // This is pick-up, and losing it would erase the thing PR teams measure.
    const verdict = classifyDuplicate(candidate(), release);

    expect(verdict.kind).toBe("SYNDICATED");
    expect(verdict.similarity).toBeGreaterThan(0.25);
    expect(verdict.reason).toContain("Cycling Review");
  });

  it("keeps genuinely different content distinct", () => {
    const verdict = classifyDuplicate(candidate({ text: BRAND_PAGE_TEXT }), release);

    expect(verdict.kind).toBe("DISTINCT");
  });

  it("lets a semantic score catch a rewrite that shares few words", () => {
    const rewritten = candidate({ text: "Le constructeur ouvre un atelier de réparation à Lyon." });

    expect(classifyDuplicate(rewritten, release).kind).toBe("DISTINCT");
    expect(classifyDuplicate(rewritten, release, 0.95).kind).toBe("SYNDICATED");
  });

  it("only withholds real copies from retrieval", () => {
    expect(suppressesContent("IDENTICAL")).toBe(true);
    expect(suppressesContent("NEAR_DUPLICATE")).toBe(true);
    expect(suppressesContent("SYNDICATED")).toBe(false);
    expect(suppressesContent("DISTINCT")).toBe(false);
  });
});

describe("finding the best match in the corpus", () => {
  it("returns the strongest verdict across everything stored", () => {
    const stored = [candidate({ sourceId: "unrelated", text: BRAND_PAGE_TEXT }), release];

    expect(findDuplicate(candidate(), stored).matchedSourceId).toBe("release");
  });

  it("is distinct when the corpus is empty", () => {
    expect(findDuplicate(candidate(), []).kind).toBe("DISTINCT");
  });

  it("never matches a source against itself", () => {
    expect(findDuplicate(release, [release]).kind).toBe("DISTINCT");
  });
});
