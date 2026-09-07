import { lookup } from "node:dns/promises";
import { serverEnv } from "@/lib/env";
import { assertPublicUrl, isPrivateAddress, normalizeUrl } from "@/lib/external/url";

/**
 * Outbound fetching for the external half.
 *
 * The interface is the point: everything downstream depends on `HtmlFetcher`,
 * not on `fetch`. Swapping in a hosted scraping service later is a
 * configuration change, not a rewrite.
 *
 * The direct implementation treats the network as hostile in both directions:
 *   - the URL is validated before the request,
 *   - the hostname is resolved and every address checked, so a public name
 *     pointing at 127.0.0.1 or 169.254.169.254 is refused,
 *   - redirects are followed manually and each hop is re-validated,
 *   - the response is capped in bytes and in time, and its content type must be
 *     something we can actually read.
 */

export const MAX_RESPONSE_BYTES = 2_000_000;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 4;

export const USER_AGENT =
  "BrandMemoryBot/1.0 (+https://github.com/Pauldelacv/Brand-Memory; external brand memory)";

const READABLE_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/json",
];

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface FetchedDocument {
  /** The URL the content was finally served from, normalised. */
  url: string;
  requestedUrl: string;
  status: number;
  contentType: string;
  body: string;
  byteSize: number;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
}

export interface HtmlFetcher {
  readonly name: string;
  fetch(url: string, options?: FetchOptions): Promise<FetchedDocument>;
}

export interface FetcherDeps {
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to a DNS lookup of every address for the host. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

/** Rejects a host whose DNS answer includes any non-public address. */
export async function assertPublicHost(
  hostname: string,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<void> {
  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch (error) {
    throw new FetchError(`"${hostname}" could not be resolved.`, hostname, error);
  }

  if (addresses.length === 0) {
    throw new FetchError(`"${hostname}" resolved to no address.`, hostname);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new FetchError(
        `"${hostname}" resolves to a private address (${address}) and will not be fetched.`,
        hostname,
      );
    }
  }
}

function isReadableContentType(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return READABLE_CONTENT_TYPES.some((allowed) => base === allowed || base.endsWith(`+${allowed.split("/")[1]}`));
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<{ body: string; byteSize: number }> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new FetchError(`The page is larger than the ${maxBytes} byte limit.`, url);
  }

  const stream = response.body;
  if (!stream) {
    const body = await response.text();
    const byteSize = Buffer.byteLength(body);
    if (byteSize > maxBytes) {
      throw new FetchError(`The page is larger than the ${maxBytes} byte limit.`, url);
    }
    return { body, byteSize };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      byteSize += value.byteLength;
      if (byteSize > maxBytes) {
        await reader.cancel();
        throw new FetchError(`The page is larger than the ${maxBytes} byte limit.`, url);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { body: Buffer.concat(chunks).toString("utf-8"), byteSize };
}

export function createDirectFetcher(deps: FetcherDeps = {}): HtmlFetcher {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveHost = deps.resolveHost ?? defaultResolveHost;

  return {
    name: "direct",

    async fetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchedDocument> {
      const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
      const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
      const requestedUrl = normalizeUrl(rawUrl);

      let current = requestedUrl;

      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        // Re-validated on every hop: a redirect is a new request to a new host.
        const url = assertPublicUrl(current);
        await assertPublicHost(url.hostname, resolveHost);

        let response: Response;
        try {
          response = await fetchImpl(url.toString(), {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              "user-agent": USER_AGENT,
              accept: options.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
              "accept-language": "en;q=0.9,fr;q=0.8,*;q=0.5",
            },
          });
        } catch (error) {
          const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
          throw new FetchError(`The request to ${url.hostname} ${reason}.`, current, error);
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) {
            throw new FetchError(`Redirect without a destination (${response.status}).`, current);
          }
          current = normalizeUrl(new URL(location, url).toString());
          continue;
        }

        if (!response.ok) {
          throw new FetchError(`The page answered ${response.status}.`, current);
        }

        const contentType = response.headers.get("content-type") ?? "text/html";
        if (!isReadableContentType(contentType)) {
          throw new FetchError(`"${contentType}" is not a readable document.`, current);
        }

        const { body, byteSize } = await readCapped(response, maxBytes, current);

        return {
          url: current,
          requestedUrl,
          status: response.status,
          contentType,
          body,
          byteSize,
        };
      }

      throw new FetchError(`Too many redirects (more than ${MAX_REDIRECTS}).`, requestedUrl);
    },
  };
}

/**
 * Seam for a hosted scraping/rendering service. The contract is one POST that
 * returns `{ url, html }`; the rest of the pipeline neither knows nor cares.
 * Configured with EXTERNAL_FETCH_ENDPOINT / EXTERNAL_FETCH_API_KEY.
 */
export function createRemoteFetcher(endpoint: string, apiKey: string | undefined): HtmlFetcher {
  return {
    name: "remote",

    async fetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchedDocument> {
      // The URL is still validated here: outsourcing the fetch does not
      // outsource the responsibility for what we ask it to fetch.
      const url = assertPublicUrl(rawUrl);
      const requestedUrl = normalizeUrl(url.toString());

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS * 2),
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ url: requestedUrl }),
        });
      } catch (error) {
        throw new FetchError("The scraping service could not be reached.", requestedUrl, error);
      }

      if (!response.ok) {
        throw new FetchError(`The scraping service answered ${response.status}.`, requestedUrl);
      }

      const payload = (await response.json()) as { url?: unknown; html?: unknown };
      const html = typeof payload.html === "string" ? payload.html : "";
      if (!html) {
        throw new FetchError("The scraping service returned no content.", requestedUrl);
      }

      const finalUrl = typeof payload.url === "string" ? normalizeUrl(payload.url) : requestedUrl;

      return {
        url: finalUrl,
        requestedUrl,
        status: 200,
        contentType: "text/html",
        body: html,
        byteSize: Buffer.byteLength(html),
      };
    },
  };
}

let cachedFetcher: HtmlFetcher | null = null;

export function getHtmlFetcher(): HtmlFetcher {
  if (cachedFetcher) return cachedFetcher;

  const endpoint = serverEnv.externalFetchEndpoint();
  cachedFetcher = endpoint
    ? createRemoteFetcher(endpoint, serverEnv.externalFetchApiKey())
    : createDirectFetcher();

  return cachedFetcher;
}

/** Test seam, mirroring setAIProvider. */
export function setHtmlFetcher(fetcher: HtmlFetcher | null): void {
  cachedFetcher = fetcher;
}
