import type { ExternalConnectorKind, ExternalSourceType } from "@/types/external";
import type { FetchedDocument, HtmlFetcher } from "@/lib/external/fetcher";
import type { PageMetadata } from "@/lib/external/html";

/**
 * The acquisition seam.
 *
 * Every way of finding brand content — a pasted URL, a sitemap, a feed, a site
 * crawl, and later Google News, YouTube or a press database — implements this
 * one interface. `discover` is what differs between them; fetching, normalising
 * and metadata extraction are shared, so a new connector is usually just a
 * `discover`.
 */

export interface DiscoveredItem {
  url: string;
  title: string | null;
  publishedAt: string | null;
  author: string | null;
  publisher: string | null;
  summary: string | null;
  sourceType: ExternalSourceType;
}

export interface DiscoveryContext {
  /** The feed URL, seed domain, or single URL the connector was given. */
  target: string;
  maxDocuments: number;
  /** URL hashes already stored for this brand: discovery skips them. */
  knownUrlHashes: ReadonlySet<string>;
  fetcher: HtmlFetcher;
  /** Domains the brand publishes on, used to type owned content. */
  ownedDomains: readonly string[];
}

export interface DiscoveryResult {
  items: DiscoveredItem[];
  /** Anything the operator should know: robots exclusions, skipped hosts, caps hit. */
  notes: string[];
}

export interface NormalizedContent extends PageMetadata {
  url: string;
  body: string;
  wordCount: number;
  sourceType: ExternalSourceType;
}

export interface SourceConnector {
  readonly kind: ExternalConnectorKind;
  discover(context: DiscoveryContext): Promise<DiscoveryResult>;
  fetch(url: string, context: DiscoveryContext): Promise<FetchedDocument>;
  normalize(document: FetchedDocument, context: DiscoveryContext): NormalizedContent;
  extractMetadata(document: FetchedDocument): PageMetadata;
}
