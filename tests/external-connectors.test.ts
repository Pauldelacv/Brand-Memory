import { describe, expect, it } from "vitest";
import { extractLinks, feedTitle, isSitemapIndex, parseFeed, parseSitemap } from "@/lib/external/feeds";
import { isAllowedByRobots, parseRobots } from "@/lib/external/robots";
import { crawlConnector, rssConnector, sitemapConnector, urlConnector } from "@/lib/external/connectors";
import type { DiscoveryContext } from "@/lib/external/connectors/types";
import type { FetchedDocument, HtmlFetcher } from "@/lib/external/fetcher";
import { urlHash } from "@/lib/external/url";
import { fixture } from "./fixtures/external";

/** A fetcher backed by a fixed map of URLs, so discovery is testable offline. */
function stubFetcher(pages: Record<string, string>): HtmlFetcher {
  return {
    name: "stub",
    async fetch(url: string): Promise<FetchedDocument> {
      const body = pages[url] ?? pages[url.replace(/\/$/, "")];
      if (body === undefined) throw new Error(`No fixture for ${url}`);
      return {
        url,
        requestedUrl: url,
        status: 200,
        contentType: "text/html",
        body,
        byteSize: body.length,
      };
    },
  };
}

function context(overrides: Partial<DiscoveryContext> & { fetcher: HtmlFetcher }): DiscoveryContext {
  return {
    target: "https://www.velvire.com/sitemap.xml",
    maxDocuments: 25,
    knownUrlHashes: new Set<string>(),
    ownedDomains: ["velvire.com"],
    ...overrides,
  };
}

describe("sitemap parsing", () => {
  it("reads every location with its last modification date", () => {
    const links = parseSitemap(fixture("sitemap.xml"));

    expect(links).toHaveLength(4);
    expect(links[0]?.url).toBe("https://www.velvire.com/newsroom/repair-atelier-lyon");
    expect(links[0]?.publishedAt).toBe("2025-03-11T00:00:00.000Z");
  });

  it("recognises a sitemap index", () => {
    expect(isSitemapIndex(fixture("sitemap-index.xml"))).toBe(true);
    expect(isSitemapIndex(fixture("sitemap.xml"))).toBe(false);
  });
});

describe("feed parsing", () => {
  it("reads an RSS channel, CDATA titles included", () => {
    const links = parseFeed(fixture("feed.rss"));

    expect(links).toHaveLength(2);
    expect(links[0]?.title).toBe("Velvire opens its first repair atelier in Lyon");
    expect(links[0]?.publishedAt).toBe("2025-03-11T09:00:00.000Z");
    expect(links[0]?.author).toBe("Velvire Press Office");
  });

  it("reads an Atom feed, where the link is an attribute", () => {
    const links = parseFeed(fixture("feed.atom"));

    expect(links[0]?.url).toBe("https://cyclingreview.example.com/2025/03/velvire-repair-atelier");
    expect(links[0]?.publishedAt).toBe("2025-03-12T07:30:00.000Z");
    expect(links[1]?.publishedAt).toBe("2025-02-20T11:00:00.000Z");
  });

  it("names the feed so a source without a publisher gets one", () => {
    expect(feedTitle(fixture("feed.rss"))).toBe("Velvire Newsroom");
  });
});

describe("robots.txt", () => {
  const rules = parseRobots(fixture("robots.txt"), "brandmemorybot");

  it("prefers the group naming our agent", () => {
    expect(rules.disallow).toEqual(["/private"]);
    expect(rules.crawlDelaySeconds).toBe(2);
  });

  it("collects sitemaps whichever group declared them", () => {
    expect(rules.sitemaps).toEqual(["https://www.velvire.com/sitemap.xml"]);
  });

  it("blocks a disallowed path and allows everything else", () => {
    expect(isAllowedByRobots(rules, "/private/board")).toBe(false);
    expect(isAllowedByRobots(rules, "/newsroom/atelier")).toBe(true);
  });

  it("lets the longest matching rule win", () => {
    const wildcard = parseRobots("User-agent: *\nDisallow: /news\nAllow: /news/public", "brandmemorybot");

    expect(isAllowedByRobots(wildcard, "/news/private")).toBe(false);
    expect(isAllowedByRobots(wildcard, "/news/public/a")).toBe(true);
  });
});

describe("connectors", () => {
  it("takes a single URL as one item", async () => {
    const result = await urlConnector.discover(
      context({ target: "https://brand.com/news/a", fetcher: stubFetcher({}) }),
    );

    expect(result.items.map((item) => item.url)).toEqual(["https://brand.com/news/a"]);
  });

  it("skips a URL the brand has already read", async () => {
    const known = new Set([urlHash("https://brand.com/news/a")]);
    const result = await urlConnector.discover(
      context({ target: "https://brand.com/news/a?utm_source=x", knownUrlHashes: known, fetcher: stubFetcher({}) }),
    );

    expect(result.items).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("already-known");
  });

  it("discovers pages from a sitemap and leaves assets out", async () => {
    const result = await sitemapConnector.discover(
      context({
        target: "https://www.velvire.com/sitemap.xml",
        fetcher: stubFetcher({ "https://www.velvire.com/sitemap.xml": fixture("sitemap.xml") }),
      }),
    );

    expect(result.items.map((item) => item.url)).toEqual([
      "https://www.velvire.com/newsroom/repair-atelier-lyon",
      "https://www.velvire.com/newsroom/2024-collection",
      "https://www.velvire.com/atelier",
    ]);
  });

  it("follows a sitemap index one level down", async () => {
    const result = await sitemapConnector.discover(
      context({
        target: "https://www.velvire.com/sitemap.xml",
        fetcher: stubFetcher({
          "https://www.velvire.com/sitemap.xml": fixture("sitemap-index.xml"),
          "https://www.velvire.com/sitemap-news.xml": fixture("sitemap.xml"),
          "https://www.velvire.com/sitemap-pages.xml": "<urlset></urlset>",
        }),
      }),
    );

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.notes.join(" ")).toContain("child sitemap");
  });

  it("honours the per-sync document cap", async () => {
    const result = await sitemapConnector.discover(
      context({
        maxDocuments: 2,
        fetcher: stubFetcher({ "https://www.velvire.com/sitemap.xml": fixture("sitemap.xml") }),
      }),
    );

    expect(result.items).toHaveLength(2);
    expect(result.notes.join(" ")).toContain("2 document limit");
  });

  it("discovers entries from a feed and carries their dates", async () => {
    const result = await rssConnector.discover(
      context({
        target: "https://www.velvire.com/newsroom/rss",
        fetcher: stubFetcher({ "https://www.velvire.com/newsroom/rss": fixture("feed.rss") }),
      }),
    );

    expect(result.items[0]?.publishedAt).toBe("2025-03-11T09:00:00.000Z");
    expect(result.items[0]?.publisher).toBe("Velvire Newsroom");
  });

  it("crawls within one site and refuses to leave it", async () => {
    const index = `<html><body><a href="/newsroom/a">A</a><a href="https://elsewhere.example.com/x">Off site</a><a href="/private/board">Private</a></body></html>`;

    const result = await crawlConnector.discover(
      context({
        target: "https://www.velvire.com/newsroom",
        fetcher: stubFetcher({
          "https://www.velvire.com/robots.txt": fixture("robots.txt"),
          "https://www.velvire.com/newsroom": index,
          "https://www.velvire.com/newsroom/a": "<html><body><p>Story</p></body></html>",
        }),
      }),
    );

    const urls = result.items.map((item) => item.url);
    expect(urls).toContain("https://www.velvire.com/newsroom");
    expect(urls).toContain("https://www.velvire.com/newsroom/a");
    expect(urls.some((url) => url.includes("elsewhere.example.com"))).toBe(false);
  });

  it("obeys robots.txt while crawling", async () => {
    const index = `<html><body><a href="/private/board">Private</a></body></html>`;

    const result = await crawlConnector.discover(
      context({
        target: "https://www.velvire.com/newsroom",
        fetcher: stubFetcher({
          "https://www.velvire.com/robots.txt": fixture("robots.txt"),
          "https://www.velvire.com/newsroom": index,
          "https://www.velvire.com/private/board": "<html><body><p>Secret</p></body></html>",
        }),
      }),
    );

    expect(result.items.map((item) => item.url)).not.toContain("https://www.velvire.com/private/board");
    expect(result.notes.join(" ")).toContain("robots.txt");
  });
});

describe("link extraction", () => {
  it("resolves relative links and drops the ones we cannot follow", () => {
    const links = extractLinks(
      `<a href="/a">A</a><a href="#top">Top</a><a href="mailto:x@y.z">Mail</a><a href="https://other.example.com/b">B</a>`,
      "https://brand.com/news/",
    );

    expect(links).toEqual(["https://brand.com/a", "https://other.example.com/b"]);
  });
});
