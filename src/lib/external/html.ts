/**
 * Reading a web page: strip the furniture, keep the article, and pull the
 * metadata a communication record needs (who published it, when, in what
 * language, under which canonical URL).
 *
 * This is deliberately structural rather than site-specific. Nothing here knows
 * about a particular newsroom's markup, so no single site's redesign breaks it.
 */

/** Tags whose content is never part of the document. */
const DROPPED_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "form",
  "button",
  "select",
  "video",
  "audio",
];

/** Tags that are page furniture rather than content. */
const BOILERPLATE_TAGS = ["nav", "header", "footer", "aside"];

const BLOCK_TAGS = [
  "p", "div", "section", "article", "br", "li", "ul", "ol", "tr", "table",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "figure", "figcaption",
  "dd", "dt", "dl", "main", "hr",
];

/** Class or id fragments that mark a container as furniture. */
const BOILERPLATE_HINTS = [
  "nav", "menu", "header", "footer", "sidebar", "side-bar", "cookie", "consent",
  "newsletter", "subscribe", "share", "social", "related", "recommend", "promo",
  "advert", "banner", "breadcrumb", "pagination", "comment", "modal", "popup",
  "skip-link", "site-search",
];

export interface PageMetadata {
  title: string;
  description: string;
  canonicalUrl: string | null;
  author: string | null;
  publisher: string | null;
  publishedAt: string | null;
  language: string | null;
  images: string[];
  /** Schema.org @type when the page carries JSON-LD, e.g. "NewsArticle". */
  schemaType: string | null;
}

export interface ReadablePage extends PageMetadata {
  text: string;
  wordCount: number;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  ccedil: "ç",
  ugrave: "ù",
  ocirc: "ô",
  icirc: "î",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function stripTag(html: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const orphanOpen = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  return html.replace(paired, " ").replace(orphanOpen, " ");
}

/** Turns a fragment of HTML into text, keeping paragraph boundaries. */
export function htmlToText(html: string): string {
  let text = html;
  for (const tag of DROPPED_TAGS) text = stripTag(text, tag);

  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  for (const tag of BLOCK_TAGS) {
    text = text
      .replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "\n\n")
      .replace(new RegExp(`<\\/${tag}\\s*>`, "gi"), "\n\n");
  }

  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);

  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!match) return null;
  const value = match[2] ?? match[3] ?? match[4] ?? "";
  return decodeEntities(value).trim() || null;
}

function metaContent(html: string, matcher: RegExp): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (matcher.test(tag)) {
      const content = attribute(tag, "content");
      if (content) return content;
    }
  }
  return null;
}

function firstJsonLd(html: string): Record<string, unknown> | null {
  const blocks =
    html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ??
    [];

  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>\s*$/i, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeEntities(body));
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed["@graph"])
        ? (parsed["@graph"] as unknown[])
        : [parsed];

    for (const candidate of candidates) {
      if (isRecord(candidate) && typeof candidate["@type"] === "string") return candidate;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readName(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = readName(item);
      if (name) return name;
    }
    return null;
  }
  if (isRecord(value) && typeof value.name === "string") return value.name.trim() || null;
  return null;
}

/** Accepts anything Date can parse and returns an ISO string, or null. */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Bare "2024-05-01" parses as UTC midnight, which is what we want.
  const time = Date.parse(trimmed);
  if (Number.isNaN(time)) return null;

  const date = new Date(time);
  // A date far outside plausible publishing range is a parsing accident.
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;

  return date.toISOString();
}

export function extractMetadata(html: string, requestUrl?: string): PageMetadata {
  const jsonLd = firstJsonLd(html);

  const ogTitle = metaContent(html, /property\s*=\s*["']og:title["']/i);
  const twitterTitle = metaContent(html, /name\s*=\s*["']twitter:title["']/i);
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const jsonLdTitle = jsonLd ? readName(jsonLd.headline ?? jsonLd.name) : null;

  const title = (jsonLdTitle ?? ogTitle ?? twitterTitle ?? (titleTag ? decodeEntities(titleTag) : null) ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const description =
    metaContent(html, /property\s*=\s*["']og:description["']/i) ??
    metaContent(html, /name\s*=\s*["']description["']/i) ??
    (jsonLd && typeof jsonLd.description === "string" ? jsonLd.description : null) ??
    "";

  let canonicalUrl: string | null = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel\s*=\s*["']?canonical\b/i.test(tag)) {
      canonicalUrl = attribute(tag, "href");
      if (canonicalUrl) break;
    }
  }
  canonicalUrl ??= metaContent(html, /property\s*=\s*["']og:url["']/i);

  const publishedAt =
    normalizeDate(metaContent(html, /property\s*=\s*["']article:published_time["']/i)) ??
    normalizeDate(jsonLd && typeof jsonLd.datePublished === "string" ? jsonLd.datePublished : null) ??
    normalizeDate(metaContent(html, /name\s*=\s*["'](?:date|pubdate|publish[-_]?date|dc\.date)["']/i)) ??
    normalizeDate(metaContent(html, /itemprop\s*=\s*["']datePublished["']/i)) ??
    normalizeDate(html.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i)?.[1]) ??
    normalizeDate(jsonLd && typeof jsonLd.dateModified === "string" ? jsonLd.dateModified : null);

  const author =
    (jsonLd ? readName(jsonLd.author) : null) ??
    metaContent(html, /property\s*=\s*["']article:author["']/i) ??
    metaContent(html, /name\s*=\s*["']author["']/i) ??
    null;

  const publisher =
    (jsonLd ? readName(jsonLd.publisher) : null) ??
    metaContent(html, /property\s*=\s*["']og:site_name["']/i) ??
    (requestUrl ? hostnameOf(requestUrl) : null);

  const language =
    html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1]?.slice(0, 12).toLowerCase() ??
    metaContent(html, /http-equiv\s*=\s*["']content-language["']/i)?.slice(0, 12).toLowerCase() ??
    null;

  const images: string[] = [];
  for (const key of ["og:image", "twitter:image"]) {
    const found = metaContent(html, new RegExp(`(?:property|name)\\s*=\\s*["']${key}["']`, "i"));
    if (found && !images.includes(found)) images.push(found);
  }

  return {
    title,
    description: description.replace(/\s+/g, " ").trim().slice(0, 1000),
    canonicalUrl,
    author: author?.slice(0, 200) ?? null,
    publisher: publisher?.slice(0, 200) ?? null,
    publishedAt,
    language,
    images: images.slice(0, 5),
    schemaType: jsonLd && typeof jsonLd["@type"] === "string" ? jsonLd["@type"] : null,
  };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface Candidate {
  html: string;
  text: string;
  score: number;
}

/**
 * Picks the block of the page that carries the article.
 *
 * Scoring is text density: how much of a candidate is prose rather than markup,
 * with a penalty for containers whose class or id names them as furniture. That
 * beats "take the biggest div" on real pages and needs no per-site rules.
 */
function selectMainContent(body: string): string {
  const candidates: Candidate[] = [];

  const push = (html: string, bonus: number) => {
    const text = htmlToText(html);
    if (text.length < 200) return;
    const linkDensity = linkTextRatio(html);
    const density = text.length / Math.max(html.length, 1);
    const score = text.length * (0.4 + density) * (1 - Math.min(linkDensity, 0.9)) * bonus;
    candidates.push({ html, text, score });
  };

  for (const tag of ["article", "main"]) {
    for (const block of matchBlocks(body, tag)) push(block, 1.4);
  }

  for (const block of matchBlocks(body, "div").concat(matchBlocks(body, "section"))) {
    const opening = block.match(/^<[^>]*>/)?.[0] ?? "";
    const identity = `${attribute(opening, "class") ?? ""} ${attribute(opening, "id") ?? ""}`.toLowerCase();
    const furniture = BOILERPLATE_HINTS.some((hint) => identity.includes(hint));
    const editorial = /(article|content|story|post|entry|main|body|press|release)/.test(identity);
    push(block, furniture ? 0.2 : editorial ? 1.2 : 0.9);
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  const whole = htmlToText(body);

  // If the best block holds most of the page's text anyway, prefer the page:
  // splitting a press release across two divs is common.
  if (!best || best.text.length < whole.length * 0.35) return body;
  return best.html;
}

function linkTextRatio(html: string): number {
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) ?? [];
  const linkText = anchors.map((anchor) => htmlToText(anchor)).join(" ");
  const total = htmlToText(html);
  if (total.length === 0) return 1;
  return linkText.length / total.length;
}

/** All top-level occurrences of a tag, with naive nesting support. */
function matchBlocks(html: string, tag: string): string[] {
  const blocks: string[] = [];
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let match: RegExpExecArray | null;

  while ((match = open.exec(html)) !== null) {
    if (match[0].endsWith("/>")) continue;
    const end = findClosingTag(html, tag, match.index + match[0].length);
    if (end === -1) continue;
    blocks.push(html.slice(match.index, end));
    if (blocks.length >= 60) break;
  }

  return blocks;
}

function findClosingTag(html: string, tag: string, from: number): number {
  const pattern = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, "gi");
  pattern.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

/**
 * Full read of a page: metadata plus the main text with navigation, footers and
 * scripts removed.
 */
export function readPage(html: string, requestUrl?: string): ReadablePage {
  const metadata = extractMetadata(html, requestUrl);

  let body = html.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i)?.[1] ?? html;
  for (const tag of DROPPED_TAGS) body = stripTag(body, tag);
  for (const tag of BOILERPLATE_TAGS) body = stripTag(body, tag);

  const main = selectMainContent(body);
  const text = htmlToText(main);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  return { ...metadata, text, wordCount };
}
