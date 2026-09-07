import { describe, expect, it } from "vitest";
import {
  UnsafeUrlError,
  assertPublicUrl,
  classifyMedia,
  isBlockedHostname,
  isPrivateAddress,
  isSameSite,
  looksLikeDocument,
  normalizeUrl,
  resolveCanonicalUrl,
  urlHash,
} from "@/lib/external/url";

describe("url normalization", () => {
  it("strips tracking parameters that identify a campaign, not a document", () => {
    expect(normalizeUrl("https://brand.com/news/a?utm_source=x&utm_medium=y&id=7")).toBe(
      "https://brand.com/news/a?id=7",
    );
  });

  it("orders the remaining parameters so parameter order stops mattering", () => {
    expect(normalizeUrl("https://brand.com/a?b=2&a=1")).toBe(normalizeUrl("https://brand.com/a?a=1&b=2"));
  });

  it("drops the fragment, the default port and a trailing slash", () => {
    expect(normalizeUrl("https://Brand.com:443/news/#section")).toBe("https://brand.com/news");
  });

  it("keeps a non-default path and lowercases only the host", () => {
    expect(normalizeUrl("https://Brand.com/News/Atelier")).toBe("https://brand.com/News/Atelier");
  });

  it("assumes https for a bare domain", () => {
    expect(normalizeUrl("brand.com/news")).toBe("https://brand.com/news");
  });

  it("gives two spellings of the same page the same hash", () => {
    expect(urlHash("https://brand.com/news/a?utm_source=mail")).toBe(urlHash("https://brand.com/news/a/"));
  });

  it("refuses a scheme that is not http or https", () => {
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
  });
});

describe("canonicalisation", () => {
  it("resolves a relative canonical against the fetched URL", () => {
    expect(resolveCanonicalUrl("/newsroom/atelier", "https://brand.com/newsroom/atelier?utm_source=x")).toBe(
      "https://brand.com/newsroom/atelier",
    );
  });

  it("ignores a canonical pointing at another host", () => {
    // Otherwise a syndicated copy could claim the identity of the original.
    expect(resolveCanonicalUrl("https://aggregator.example.com/x", "https://press.example.com/y")).toBe(
      "https://press.example.com/y",
    );
  });

  it("falls back to the request URL when there is no canonical", () => {
    expect(resolveCanonicalUrl(null, "https://brand.com/a/")).toBe("https://brand.com/a");
  });
});

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"])(
    "treats %s as public",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it.each(["localhost", "router.local", "vault.internal", "metadata.google.internal", "intranet"])(
    "blocks the hostname %s",
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    },
  );

  it("refuses the cloud metadata address", () => {
    expect(() => assertPublicUrl("http://169.254.169.254/latest/meta-data/")).toThrow(UnsafeUrlError);
  });

  it("refuses credentials embedded in the URL", () => {
    expect(() => assertPublicUrl("https://user:secret@brand.com/")).toThrow(/credentials/);
  });

  it("refuses a non-web port", () => {
    expect(() => assertPublicUrl("http://brand.com:6379/")).toThrow(/Port 6379/);
  });

  it("refuses a non-http scheme", () => {
    expect(() => assertPublicUrl("gopher://brand.com/")).toThrow(UnsafeUrlError);
  });

  it("allows an ordinary public page", () => {
    expect(assertPublicUrl("https://brand.com/newsroom").hostname).toBe("brand.com");
  });
});

describe("site and media classification", () => {
  it("treats www and the apex as the same site", () => {
    expect(isSameSite("https://www.brand.com/a", "https://brand.com/b")).toBe(true);
  });

  it("does not treat a look-alike domain as the same site", () => {
    expect(isSameSite("https://brand.com/a", "https://brand-com.example.net/b")).toBe(false);
  });

  it("marks a page on an owned domain as owned media", () => {
    expect(classifyMedia("https://news.brand.com/a", ["brand.com"], null)).toBe("OWNED");
  });

  it("marks coverage elsewhere as earned media", () => {
    expect(classifyMedia("https://cyclingreview.example.com/a", ["brand.com"], null)).toBe("EARNED");
  });

  it("stays unknown when the brand has declared no domains", () => {
    expect(classifyMedia("https://anywhere.example.com/a", [], null)).toBe("UNKNOWN");
  });

  it("skips assets when crawling", () => {
    expect(looksLikeDocument("https://brand.com/a/hero.jpg")).toBe(false);
    expect(looksLikeDocument("https://brand.com/newsroom/atelier")).toBe(true);
  });
});
