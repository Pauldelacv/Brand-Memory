import { extractLinks, feedTitle, isSitemapIndex, parseFeed, parseSitemap } from "@/lib/external/feeds";
import { isAllowedByRobots, parseRobots } from "@/lib/external/robots";
import type { RobotsRules } from "@/lib/external/robots";
import {
  hostOf,
  isSameSite,
  looksLikeDocument,
  normalizeUrl,
  registrableHost,
  urlHash,
} from "@/lib/external/url";
import { defineConnector } from "@/lib/external/connectors/base";
import type { DiscoveredItem, DiscoveryContext, DiscoveryResult, SourceConnector } from "@/lib/external/connectors/types";
import type { ExternalConnectorKind, ExternalSourceType } from "@/types/external";

/**
 * The four connectors the MVP ships with. Adding Google News, YouTube or a
 * press database later means adding a `discover` here and a value to the
 * `external_connector_kind` enum — nothing else in the pipeline changes.
 */

/** Sitemap indexes are followed one level; deeper nesting is rare and unbounded. */
const MAX_SITEMAP_CHILDREN = 5;
const MAX_CRAWL_FETCHES = 30;

function toItem(
  url: string,
  overrides: Partial<DiscoveredItem> = {},
  sourceType: ExternalSourceType = "WEB_PAGE",
): DiscoveredItem {
  return {
    url,
    title: null,
    publishedAt: null,
    author: null,
    publisher: null,
    summary: null,
    sourceType,
    ...overrides,
  };
}

/**
 * Drops URLs we already hold and URLs that are plainly not documents, then
 * applies the connector's budget. Deduplication proper happens after fetching;
 * this only avoids paying for what we already know.
 */
function selectNew(
  candidates: DiscoveredItem[],
  context: DiscoveryContext,
  notes: string[],
): DiscoveredItem[] {
  const seen = new Set<string>();
  const selected: DiscoveredItem[] = [];
  let known = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    let normalized: string;
    let hash: string;
    try {
      normalized = normalizeUrl(candidate.url);
      hash = urlHash(normalized);
    } catch {
      skipped += 1;
      continue;
    }

    if (seen.has(hash)) continue;
    seen.add(hash);

    if (context.knownUrlHashes.has(hash)) {
      known += 1;
      continue;
    }
    if (!looksLikeDocument(normalized)) {
      skipped += 1;
      continue;
    }

    selected.push({ ...candidate, url: normalized });
    if (selected.length >= context.maxDocuments) {
      notes.push(`Stopped at the ${context.maxDocuments} document limit for this sync.`);
      break;
    }
  }

  if (known > 0) notes.push(`${known} already-known URL${known === 1 ? "" : "s"} skipped.`);
  if (skipped > 0) notes.push(`${skipped} link${skipped === 1 ? "" : "s"} ignored as non-documents.`);

  return selected;
}

export const urlConnector: SourceConnector = defineConnector("URL", async (context) => {
  const notes: string[] = [];
  const items = selectNew([toItem(context.target)], context, notes);

  if (items.length === 0 && notes.length === 0) {
    notes.push("That URL is already in the external memory.");
  }
  return { items, notes };
});

export const sitemapConnector: SourceConnector = defineConnector("SITEMAP", async (context) => {
  const notes: string[] = [];
  const document = await context.fetcher.fetch(context.target, {
    accept: "application/xml,text/xml;q=0.9,*/*;q=0.5",
  });

  let links = parseSitemap(document.body);

  if (isSitemapIndex(document.body)) {
    const children = links.slice(0, MAX_SITEMAP_CHILDREN);
    notes.push(`Sitemap index: followed ${children.length} child sitemap${children.length === 1 ? "" : "s"}.`);

    const collected: typeof links = [];
    for (const child of children) {
      try {
        const childDocument = await context.fetcher.fetch(child.url, {
          accept: "application/xml,text/xml;q=0.9,*/*;q=0.5",
        });
        collected.push(...parseSitemap(childDocument.body));
      } catch (error) {
        notes.push(`Child sitemap ${child.url} could not be read: ${describe(error)}`);
      }
    }
    links = collected;
  }

  // Newest first: a sitemap can list years of pages and the budget is finite.
  const ordered = [...links].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  const items = selectNew(
    ordered.map((link) => toItem(link.url, { title: link.title, publishedAt: link.publishedAt })),
    context,
    notes,
  );

  return { items, notes };
});

export const rssConnector: SourceConnector = defineConnector("RSS", async (context) => {
  const notes: string[] = [];
  const document = await context.fetcher.fetch(context.target, {
    accept: "application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5",
  });

  const publisher = feedTitle(document.body);
  const links = parseFeed(document.body);

  if (links.length === 0) notes.push("No entries were found in that feed.");

  const items = selectNew(
    links.map((link) =>
      toItem(link.url, {
        title: link.title,
        publishedAt: link.publishedAt,
        author: link.author,
        summary: link.summary,
        publisher,
      }),
    ),
    context,
    notes,
  );

  return { items, notes };
});

/**
 * Breadth-first walk of one site. Stays on the seed's own site, honours
 * robots.txt, and spends a fixed number of fetches on discovery so a large
 * newsroom cannot turn one sync into an unbounded job.
 */
export const crawlConnector: SourceConnector = defineConnector("CRAWL", async (context) => {
  const notes: string[] = [];
  const seed = normalizeUrl(context.target);
  const robots = await loadRobots(seed, context, notes);

  const queue: string[] = [seed];
  const visited = new Set<string>();
  const found: DiscoveredItem[] = [];
  let fetches = 0;
  let blocked = 0;

  while (queue.length > 0 && fetches < MAX_CRAWL_FETCHES && found.length < context.maxDocuments * 3) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    if (robots && !isAllowedByRobots(robots, pathOf(current))) {
      blocked += 1;
      continue;
    }

    let body: string;
    try {
      const document = await context.fetcher.fetch(current);
      body = document.body;
      fetches += 1;
    } catch (error) {
      notes.push(`${current} could not be read: ${describe(error)}`);
      continue;
    }

    found.push(toItem(current));

    for (const link of extractLinks(body, current)) {
      let normalized: string;
      try {
        normalized = normalizeUrl(link);
      } catch {
        continue;
      }
      if (visited.has(normalized) || queue.includes(normalized)) continue;
      if (!isSameSite(normalized, seed)) continue;
      if (!looksLikeDocument(normalized)) continue;
      queue.push(normalized);
    }
  }

  if (blocked > 0) notes.push(`${blocked} URL${blocked === 1 ? "" : "s"} skipped because robots.txt disallows them.`);
  if (fetches >= MAX_CRAWL_FETCHES) notes.push(`Crawl stopped after ${MAX_CRAWL_FETCHES} pages.`);

  const items = selectNew(found, context, notes);
  return { items, notes };
});

async function loadRobots(
  seed: string,
  context: DiscoveryContext,
  notes: string[],
): Promise<RobotsRules | null> {
  try {
    const origin = new URL(seed).origin;
    const document = await context.fetcher.fetch(`${origin}/robots.txt`, { accept: "text/plain" });
    return parseRobots(document.body, "brandmemorybot");
  } catch {
    // No robots.txt is an answer: crawl politely within the other limits.
    notes.push(`No robots.txt found for ${registrableHost(hostOf(seed))}; crawling within the page limit.`);
    return null;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

const CONNECTORS: Record<ExternalConnectorKind, SourceConnector> = {
  URL: urlConnector,
  SITEMAP: sitemapConnector,
  RSS: rssConnector,
  CRAWL: crawlConnector,
};

export function getConnector(kind: ExternalConnectorKind): SourceConnector {
  return CONNECTORS[kind];
}

export type { DiscoveredItem, DiscoveryContext, DiscoveryResult, SourceConnector };
