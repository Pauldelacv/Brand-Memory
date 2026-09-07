import { describe, expect, it } from "vitest";
import { decodeEntities, extractMetadata, htmlToText, normalizeDate, readPage } from "@/lib/external/html";
import { guessSourceType } from "@/lib/external/connectors/base";
import { fixture } from "./fixtures/external";

const PRESS_RELEASE = fixture("press-release.html");
const NEWS_ARTICLE = fixture("news-article.html");
const BRAND_PAGE = fixture("brand-page.html");

describe("content extraction", () => {
  it("keeps the article and drops the furniture", () => {
    const page = readPage(PRESS_RELEASE, "https://www.velvire.com/newsroom/repair-atelier-lyon");

    expect(page.text).toContain("first of five planned across France");
    expect(page.text).toContain("A bike that cannot be repaired");
    expect(page.text).not.toContain("All rights reserved");
    expect(page.text).not.toContain("Cookies");
  });

  it("removes scripts and styles rather than reading them as prose", () => {
    const page = readPage(PRESS_RELEASE, "https://www.velvire.com/newsroom/repair-atelier-lyon");

    expect(page.text).not.toContain("dataLayer");
    expect(page.text).not.toContain("masthead { color");
  });

  it("finds the body of a page that has no article element", () => {
    const page = readPage(NEWS_ARTICLE, "https://cyclingreview.example.com/2025/03/velvire-repair-atelier");

    expect(page.text).toContain("rue Sainte-Catherine");
    expect(page.text).not.toContain("Get our weekly briefing");
    expect(page.text).not.toContain("We use cookies");
  });

  it("reads a plain brand page with no schema markup", () => {
    const page = readPage(BRAND_PAGE, "https://www.velvire.com/atelier");

    expect(page.text).toContain("onze personnes");
    expect(page.wordCount).toBeGreaterThan(40);
    expect(page.language).toBe("fr");
  });

  it("keeps paragraph boundaries so evidence stays readable", () => {
    expect(htmlToText("<p>One.</p><p>Two.</p>")).toBe("One.\n\nTwo.");
  });

  it("decodes named and numeric entities", () => {
    expect(decodeEntities("caf&eacute; &amp; co &#8212; &#x2018;yes&#x2019;")).toBe("café & co — ‘yes’");
  });
});

describe("metadata extraction", () => {
  it("prefers JSON-LD for the headline, date and author", () => {
    const metadata = extractMetadata(PRESS_RELEASE, "https://www.velvire.com/newsroom/repair-atelier-lyon");

    expect(metadata.title).toBe("Velvire opens its first repair atelier in Lyon");
    expect(metadata.publishedAt).toBe("2025-03-11T09:00:00.000Z");
    expect(metadata.author).toBe("Velvire Press Office");
    expect(metadata.publisher).toBe("Velvire");
    expect(metadata.schemaType).toBe("NewsArticle");
  });

  it("reads the canonical URL declared by the page", () => {
    const metadata = extractMetadata(PRESS_RELEASE);

    expect(metadata.canonicalUrl).toContain("/newsroom/repair-atelier-lyon");
  });

  it("falls back to meta tags when there is no JSON-LD", () => {
    const metadata = extractMetadata(NEWS_ARTICLE, "https://cyclingreview.example.com/2025/03/velvire");

    expect(metadata.publisher).toBe("The Cycling Review");
    expect(metadata.author).toBe("Marta Oyelaran");
    expect(metadata.publishedAt).toBe("2025-03-12T07:30:00.000Z");
  });

  it("falls back to the host when the page names no publisher", () => {
    const metadata = extractMetadata("<html><head><title>A</title></head><body><p>x</p></body></html>", "https://www.velvire.com/a");

    expect(metadata.publisher).toBe("velvire.com");
  });

  it("rejects a date outside any plausible publishing range", () => {
    expect(normalizeDate("0001-01-01")).toBeNull();
    expect(normalizeDate("not a date")).toBeNull();
    expect(normalizeDate("2024-05-01")).toBe("2024-05-01T00:00:00.000Z");
  });
});

describe("content typing", () => {
  const owned = ["velvire.com"];

  it("types a release on the brand's own newsroom as a press release", () => {
    const metadata = extractMetadata(PRESS_RELEASE);
    expect(guessSourceType("https://www.velvire.com/newsroom/repair-atelier-lyon", metadata, owned)).toBe(
      "PRESS_RELEASE",
    );
  });

  it("types the same story elsewhere as an article", () => {
    const metadata = extractMetadata(NEWS_ARTICLE);
    expect(
      guessSourceType("https://cyclingreview.example.com/2025/03/velvire-repair-atelier", metadata, owned),
    ).toBe("ARTICLE");
  });

  it("types an interview from what the page is called", () => {
    const metadata = extractMetadata(
      '<html><head><title>Interview: Claire Fontaine on repairability</title></head><body></body></html>',
    );
    expect(guessSourceType("https://cyclingreview.example.com/features/claire", metadata, owned)).toBe(
      "INTERVIEW",
    );
  });

  it("types a video host as a video", () => {
    expect(guessSourceType("https://www.youtube.com/watch?v=abc", extractMetadata("<html></html>"), owned)).toBe(
      "VIDEO",
    );
  });
});
