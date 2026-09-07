import { createHash } from "node:crypto";

/**
 * URL handling for the external half: normalisation, canonicalisation, and the
 * guard that decides whether a URL may be fetched at all.
 *
 * Fetching URLs a user supplies is the largest attack surface in this feature.
 * Everything here is pure so the rules can be tested directly; the DNS-level
 * checks that need IO live in fetcher.ts and build on these primitives.
 */

/** Query parameters that identify a campaign, not a document. */
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "twclid",
  "ref",
  "ref_src",
  "referrer",
  "source",
  "spm",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "yclid",
];

const TRACKING_PREFIXES = ["utm_", "pk_", "piwik_", "hsa_", "at_"];

/** Hosts that must never be resolved, whatever the DNS says. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".onion"];

/** Extensions we know are not readable documents. Cheap pre-filter for crawling. */
const NON_DOCUMENT_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".tif", ".tiff",
  ".mp4", ".webm", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".ogg", ".m4a",
  ".zip", ".gz", ".tar", ".rar", ".7z", ".dmg", ".exe", ".pkg",
  ".css", ".js", ".mjs", ".map", ".woff", ".woff2", ".ttf", ".otf", ".eot",
];

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class InvalidUrlError extends Error {
  constructor(value: string) {
    super(`"${value.slice(0, 120)}" is not a URL we can read.`);
    this.name = "InvalidUrlError";
  }
}

export function parseUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidUrlError(raw);

  // A bare domain is a common paste; assume https rather than rejecting it.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withScheme);
  } catch {
    throw new InvalidUrlError(raw);
  }
}

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.includes(lower)) return true;
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * A stable identity for a page: scheme and host lowercased, default port and
 * fragment dropped, tracking parameters removed, remaining parameters sorted,
 * and a trailing slash removed from a non-root path. Two URLs that normalise to
 * the same string are the same document as far as this system is concerned.
 */
export function normalizeUrl(raw: string): string {
  const url = parseUrl(raw);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http and https URLs can be read (got "${url.protocol}").`);
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  url.hash = "";
  url.username = "";
  url.password = "";

  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  kept.sort(([a, aValue], [b, bValue]) => (a === b ? aValue.localeCompare(bValue) : a.localeCompare(b)));

  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/**
 * Resolves the canonical URL a page declares against the URL we fetched.
 * A canonical pointing at another host is ignored: that is how a syndicated
 * copy would otherwise take over the identity of the original.
 */
export function resolveCanonicalUrl(declared: string | null | undefined, requestUrl: string): string {
  const normalizedRequest = normalizeUrl(requestUrl);
  if (!declared || !declared.trim()) return normalizedRequest;

  try {
    const resolved = new URL(declared.trim(), normalizedRequest);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return normalizedRequest;
    if (resolved.hostname.toLowerCase() !== new URL(normalizedRequest).hostname) {
      return normalizedRequest;
    }
    return normalizeUrl(resolved.toString());
  } catch {
    return normalizedRequest;
  }
}

/** sha256 of the normalised URL. The unique key behind `external_sources`. */
export function urlHash(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}

export function hostOf(url: string): string {
  return parseUrl(url).hostname.toLowerCase();
}

/** "www.example.com" and "example.com" are the same site; "evil-example.com" is not. */
export function registrableHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function isSameSite(a: string, b: string): boolean {
  const left = registrableHost(hostOf(a));
  const right = registrableHost(hostOf(b));
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

export function looksLikeDocument(url: string): boolean {
  const path = parseUrl(url).pathname.toLowerCase();
  return !NON_DOCUMENT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** IPv4 in dotted-quad form, as an array of octets, or null. */
function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/**
 * True for anything that is not routable on the public internet: loopback,
 * link-local (including the cloud metadata address), private ranges, CGNAT,
 * multicast, reserved. Both IPv4 and IPv6, including IPv4-mapped IPv6.
 */
export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!value) return true;

  const ipv4 = parseIpv4(value);
  if (ipv4) {
    const [a = 0, b = 0] = ipv4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51) return true; // documentation
    if (a === 203 && b === 0) return true; // documentation
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  if (!value.includes(":")) {
    // Not an IP literal at all; hostname rules handle it.
    return false;
  }

  if (value === "::" || value === "::1") return true;

  // IPv4-mapped and IPv4-compatible addresses inherit the IPv4 verdict.
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);

  if (value.startsWith("fe80") || value.startsWith("fec0")) return true; // link/site-local
  if (/^f[cd]/.test(value)) return true; // unique local fc00::/7
  if (value.startsWith("ff")) return true; // multicast
  if (value.startsWith("2001:db8")) return true; // documentation

  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // A hostname with no dot is an intranet name, not a public site.
  if (!host.includes(".") && !host.includes(":")) return true;
  return isPrivateAddress(host);
}

/**
 * The gate every outbound fetch passes. Rejects non-http schemes, embedded
 * credentials, non-standard ports, and any host that resolves — or already
 * reads — as private. DNS is checked separately at fetch time, because a
 * public name can still point at 127.0.0.1.
 */
export function assertPublicUrl(raw: string): URL {
  const url = parseUrl(raw);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http and https URLs can be read (got "${url.protocol}").`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not fetched.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UnsafeUrlError(`Port ${url.port} is not allowed. Use the standard web ports.`);
  }
  if (isBlockedHostname(url.hostname)) {
    throw new UnsafeUrlError(`"${url.hostname}" is not a public host.`);
  }

  return url;
}

/** OWNED when the page sits on a domain the brand told us it publishes on. */
export function classifyMedia(
  url: string,
  ownedDomains: readonly string[],
  website: string | null,
): "OWNED" | "EARNED" | "UNKNOWN" {
  let host: string;
  try {
    host = registrableHost(hostOf(url));
  } catch {
    return "UNKNOWN";
  }

  const owned = new Set<string>();
  for (const domain of ownedDomains) {
    try {
      owned.add(registrableHost(hostOf(domain)));
    } catch {
      // A malformed entry in the settings list is ignored rather than fatal.
    }
  }
  if (website) {
    try {
      owned.add(registrableHost(hostOf(website)));
    } catch {
      // Same.
    }
  }

  if (owned.size === 0) return "UNKNOWN";
  for (const domain of owned) {
    if (host === domain || host.endsWith(`.${domain}`)) return "OWNED";
  }
  return "EARNED";
}
