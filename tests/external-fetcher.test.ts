import { describe, expect, it } from "vitest";
import { FetchError, assertPublicHost, createDirectFetcher } from "@/lib/external/fetcher";

/**
 * Fetching URLs a user supplies is the largest attack surface in this feature,
 * and a public hostname can still resolve to a private address. These cover the
 * checks that stand between a pasted URL and the metadata endpoint.
 */

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

function fetcherFor(routes: Record<string, Route>, addresses: Record<string, string[]> = {}) {
  const requested: string[] = [];

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requested.push(url);

    const route = routes[url] ?? routes[url.replace(/\/$/, "")];
    if (!route) throw new Error(`No route for ${url}`);

    return new Response(route.body ?? "<html><body><p>ok</p></body></html>", {
      status: route.status ?? 200,
      headers: { "content-type": "text/html", ...route.headers },
    });
  }) as typeof fetch;

  const fetcher = createDirectFetcher({
    fetchImpl,
    resolveHost: async (hostname: string) => addresses[hostname] ?? ["93.184.216.34"],
  });

  return { fetcher, requested };
}

describe("host resolution", () => {
  it("refuses a public name that resolves to a private address", async () => {
    // The classic SSRF bypass: brand-lookalike.com → 127.0.0.1.
    await expect(assertPublicHost("evil.example.com", async () => ["127.0.0.1"])).rejects.toThrow(
      /private address/,
    );
  });

  it("refuses when any one of several answers is private", async () => {
    await expect(
      assertPublicHost("split.example.com", async () => ["93.184.216.34", "169.254.169.254"]),
    ).rejects.toThrow(/private address/);
  });

  it("refuses a name that resolves to nothing", async () => {
    await expect(assertPublicHost("void.example.com", async () => [])).rejects.toBeInstanceOf(FetchError);
  });

  it("accepts an ordinary public answer", async () => {
    await expect(assertPublicHost("brand.com", async () => ["93.184.216.34"])).resolves.toBeUndefined();
  });
});

describe("fetching", () => {
  it("reads a page and reports where it came from", async () => {
    const { fetcher } = fetcherFor({ "https://brand.com/news": { body: "<html><body><p>Hello</p></body></html>" } });

    const document = await fetcher.fetch("https://brand.com/news/?utm_source=x");

    expect(document.url).toBe("https://brand.com/news");
    expect(document.body).toContain("Hello");
    expect(document.status).toBe(200);
  });

  it("re-validates every redirect hop", async () => {
    // A redirect is a new request to a new host, so the guard runs again.
    const { fetcher } = fetcherFor(
      {
        "https://brand.com/news": { status: 302, headers: { location: "https://internal.example.com/secret" } },
        "https://internal.example.com/secret": { body: "<p>secret</p>" },
      },
      { "brand.com": ["93.184.216.34"], "internal.example.com": ["10.0.0.5"] },
    );

    await expect(fetcher.fetch("https://brand.com/news")).rejects.toThrow(/private address/);
  });

  it("follows a redirect that stays on the public internet", async () => {
    const { fetcher, requested } = fetcherFor({
      "https://brand.com/news": { status: 301, headers: { location: "/newsroom" } },
      "https://brand.com/newsroom": { body: "<p>Moved here</p>" },
    });

    const document = await fetcher.fetch("https://brand.com/news");

    expect(document.url).toBe("https://brand.com/newsroom");
    expect(requested).toHaveLength(2);
  });

  it("gives up rather than following a redirect loop forever", async () => {
    const { fetcher } = fetcherFor({
      "https://brand.com/a": { status: 302, headers: { location: "https://brand.com/b" } },
      "https://brand.com/b": { status: 302, headers: { location: "https://brand.com/a" } },
    });

    await expect(fetcher.fetch("https://brand.com/a")).rejects.toThrow(/Too many redirects/);
  });

  it("refuses a document type it cannot read", async () => {
    const { fetcher } = fetcherFor({
      "https://brand.com/report": { headers: { "content-type": "application/pdf" }, body: "%PDF" },
    });

    await expect(fetcher.fetch("https://brand.com/report")).rejects.toThrow(/not a readable document/);
  });

  it("refuses a response that declares itself too large", async () => {
    const { fetcher } = fetcherFor({
      "https://brand.com/huge": { headers: { "content-length": "50000000" } },
    });

    await expect(fetcher.fetch("https://brand.com/huge")).rejects.toThrow(/larger than/);
  });

  it("stops reading a body that grows past the cap", async () => {
    const { fetcher } = fetcherFor({ "https://brand.com/huge": { body: "x".repeat(5000) } });

    await expect(fetcher.fetch("https://brand.com/huge", { maxBytes: 1000 })).rejects.toThrow(/larger than/);
  });

  it("reports an error status rather than storing the error page", async () => {
    const { fetcher } = fetcherFor({ "https://brand.com/gone": { status: 404, body: "<p>Not found</p>" } });

    await expect(fetcher.fetch("https://brand.com/gone")).rejects.toThrow(/answered 404/);
  });

  it("never issues the request for a blocked URL at all", async () => {
    const { fetcher, requested } = fetcherFor({});

    await expect(fetcher.fetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
    expect(requested).toEqual([]);
  });
});
