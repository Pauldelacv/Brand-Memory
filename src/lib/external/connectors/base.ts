import { readPage } from "@/lib/external/html";
import { classifyMedia, hostOf } from "@/lib/external/url";
import type { FetchedDocument } from "@/lib/external/fetcher";
import type { PageMetadata } from "@/lib/external/html";
import type { ExternalSourceType } from "@/types/external";
import type {
  DiscoveryContext,
  DiscoveryResult,
  NormalizedContent,
  SourceConnector,
} from "@/lib/external/connectors/types";

/**
 * Fetching, normalising and metadata extraction are identical whatever found
 * the URL, so they live here once and every connector inherits them.
 */

const PRESS_PATH_HINTS = ["press", "presse", "communique", "communiques", "newsroom", "media", "medias"];
const BLOG_PATH_HINTS = ["blog", "journal", "stories", "insights"];
const NEWS_PATH_HINTS = ["news", "actualite", "actualites", "actu", "article"];
const INTERVIEW_HINTS = ["interview", "entretien", "q&a", "questions à", "en conversation"];
const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "dailymotion.com"];

/**
 * Types a piece of content from what the URL and the page itself say.
 *
 * The owned/earned split does most of the work: a press release on the brand's
 * own newsroom and a piece about the brand in a newspaper are different kinds
 * of evidence, and the analysis later treats them differently.
 */
export function guessSourceType(
  url: string,
  metadata: PageMetadata,
  ownedDomains: readonly string[],
): ExternalSourceType {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    path = parsed.pathname.toLowerCase();
  } catch {
    return "OTHER";
  }

  if (VIDEO_HOSTS.some((video) => host === video || host.endsWith(`.${video}`))) return "VIDEO";

  const haystack = `${metadata.title} ${metadata.description}`.toLowerCase();
  if (INTERVIEW_HINTS.some((hint) => haystack.includes(hint))) return "INTERVIEW";

  const segments = path.split("/").filter(Boolean);
  const owned = classifyMedia(url, ownedDomains, null) === "OWNED";

  if (segments.some((segment) => PRESS_PATH_HINTS.includes(segment))) {
    return owned ? "PRESS_RELEASE" : "NEWSROOM";
  }
  if (segments.some((segment) => BLOG_PATH_HINTS.includes(segment))) return "BLOG_POST";
  if (segments.some((segment) => NEWS_PATH_HINTS.includes(segment))) {
    return owned ? "NEWSROOM" : "ARTICLE";
  }

  if (metadata.schemaType && /article|report|blogposting/i.test(metadata.schemaType)) {
    return owned ? "NEWSROOM" : "ARTICLE";
  }

  return owned ? "WEB_PAGE" : "ARTICLE";
}

/**
 * Turns a fetched document into the normalised content the rest of the pipeline
 * stores. Shared by every connector and by re-processing, so a page read
 * through a crawl and the same page read from a pasted URL normalise the same.
 */
export function normalizeDocument(
  document: FetchedDocument,
  ownedDomains: readonly string[],
): NormalizedContent {
  const page = readPage(document.body, document.url);

  return {
    ...page,
    publisher: page.publisher ?? safeHost(document.url),
    url: document.url,
    body: page.text,
    wordCount: page.wordCount,
    sourceType: guessSourceType(document.url, page, ownedDomains),
  };
}

/** Shared implementation; a connector supplies only `kind` and `discover`. */
export function defineConnector(
  kind: SourceConnector["kind"],
  discover: (context: DiscoveryContext) => Promise<DiscoveryResult>,
): SourceConnector {
  return {
    kind,
    discover,

    fetch(url, context) {
      return context.fetcher.fetch(url);
    },

    extractMetadata(document) {
      return readPage(document.body, document.url);
    },

    normalize(document, context): NormalizedContent {
      return normalizeDocument(document, context.ownedDomains);
    },
  };
}

function safeHost(url: string): string | null {
  try {
    return hostOf(url).replace(/^www\./, "");
  } catch {
    return null;
  }
}
