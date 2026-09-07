import { decodeEntities, normalizeDate } from "@/lib/external/html";

/**
 * Sitemap and feed parsing.
 *
 * These formats are small and well specified, and the alternative — a general
 * XML dependency — buys nothing here. Everything is pure so the shapes real
 * newsrooms publish can be pinned down by fixtures.
 */

export interface DiscoveredLink {
  url: string;
  title: string | null;
  publishedAt: string | null;
  author: string | null;
  summary: string | null;
}

function tagContent(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${tag}\\s*>`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml)) !== null) {
    values.push(match[1] ?? "");
  }
  return values;
}

function firstTagContent(xml: string, tag: string): string | null {
  return tagContent(xml, tag)[0] ?? null;
}

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const text = decodeEntities(withoutCdata.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** True when the document is a sitemap index rather than a list of pages. */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

export function parseSitemap(xml: string): DiscoveredLink[] {
  const blocks = [...tagContent(xml, "url"), ...tagContent(xml, "sitemap")];
  const links: DiscoveredLink[] = [];

  for (const block of blocks) {
    const url = cleanText(firstTagContent(block, "loc"));
    if (!url) continue;

    links.push({
      url,
      title: cleanText(firstTagContent(block, "title")),
      publishedAt:
        normalizeDate(cleanText(firstTagContent(block, "publication_date"))) ??
        normalizeDate(cleanText(firstTagContent(block, "lastmod"))),
      author: null,
      summary: null,
    });
  }

  return links;
}

/** RSS 2.0 and Atom, which differ enough in element names to both be handled. */
export function parseFeed(xml: string): DiscoveredLink[] {
  const items = [...tagContent(xml, "item"), ...tagContent(xml, "entry")];
  const links: DiscoveredLink[] = [];

  for (const item of items) {
    const rssLink = cleanText(firstTagContent(item, "link"));
    const atomLink = item.match(/<(?:[a-z0-9]+:)?link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i);
    const alternate = [...(item.match(/<(?:[a-z0-9]+:)?link\b[^>]*>/gi) ?? [])].find((tag) =>
      /rel\s*=\s*["']alternate["']/i.test(tag),
    );
    const alternateHref = alternate?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];

    const url = alternateHref ?? rssLink ?? atomLink?.[1] ?? cleanText(firstTagContent(item, "guid"));
    if (!url || !/^https?:\/\//i.test(url)) continue;

    links.push({
      url,
      title: cleanText(firstTagContent(item, "title")),
      publishedAt:
        normalizeDate(cleanText(firstTagContent(item, "pubDate"))) ??
        normalizeDate(cleanText(firstTagContent(item, "published"))) ??
        normalizeDate(cleanText(firstTagContent(item, "updated"))) ??
        normalizeDate(cleanText(firstTagContent(item, "date"))),
      author:
        cleanText(firstTagContent(item, "creator")) ??
        cleanText(firstTagContent(item, "author")) ??
        null,
      summary:
        cleanText(firstTagContent(item, "description")) ??
        cleanText(firstTagContent(item, "summary")) ??
        null,
    });
  }

  return links;
}

/** The feed's own title, used to name a source's publisher when it has none. */
export function feedTitle(xml: string): string | null {
  const channel = xml.match(/<(?:[a-z0-9]+:)?channel\b[^>]*>([\s\S]*?)<(?:[a-z0-9]+:)?item\b/i)?.[1];
  if (channel) return cleanText(firstTagContent(channel, "title"));

  const head = xml.slice(0, 4000);
  return cleanText(firstTagContent(head, "title"));
}

/** Links inside an HTML page, absolute, deduplicated, in document order. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = decodeEntities(href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) continue;

    try {
      const resolved = new URL(raw, baseUrl);
      resolved.hash = "";
      const value = resolved.toString();
      if (!seen.has(value)) {
        seen.add(value);
        found.push(value);
      }
    } catch {
      // A malformed href is simply not a link we can follow.
    }
  }

  return found;
}
