/**
 * Minimal robots.txt reading. A crawler that ignores robots.txt is a crawler
 * that gets a brand's IP blocked, so the site crawl connector honours it.
 *
 * Only the directives that matter here are implemented: User-agent, Allow,
 * Disallow and Crawl-delay, with the longest matching rule winning, as the
 * de-facto standard specifies.
 */

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
  sitemaps: string[];
}

const EMPTY: RobotsRules = { allow: [], disallow: [], crawlDelaySeconds: null, sitemaps: [] };

export function parseRobots(text: string, userAgent = "brandmemorybot"): RobotsRules {
  const agent = userAgent.toLowerCase();
  const groups = new Map<string, RobotsRules>();
  const sitemaps: string[] = [];

  let currentAgents: string[] = [];
  let expectingAgents = false;

  const ruleFor = (name: string): RobotsRules => {
    const existing = groups.get(name);
    if (existing) return existing;
    const created: RobotsRules = { allow: [], disallow: [], crawlDelaySeconds: null, sitemaps: [] };
    groups.set(name, created);
    return created;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      if (!expectingAgents) currentAgents = [];
      expectingAgents = true;
      if (value) currentAgents.push(value.toLowerCase());
      continue;
    }

    expectingAgents = false;
    if (currentAgents.length === 0) continue;

    for (const name of currentAgents) {
      const rules = ruleFor(name);
      if (field === "disallow") rules.disallow.push(value);
      else if (field === "allow") rules.allow.push(value);
      else if (field === "crawl-delay") {
        const delay = Number(value);
        if (Number.isFinite(delay) && delay >= 0) rules.crawlDelaySeconds = delay;
      }
    }
  }

  const specific = groups.get(agent);
  const wildcard = groups.get("*");
  const chosen = specific ?? wildcard ?? EMPTY;

  return { ...chosen, sitemaps };
}

/** Converts a robots path pattern (supporting * and $) into a matcher. */
function matchLength(pattern: string, path: string): number {
  if (pattern === "") return -1;

  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return path.startsWith(pattern) ? pattern.length : -1;
  }

  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}${anchored ? "$" : ""}`);

  return regex.test(path) ? body.length : -1;
}

export function isAllowedByRobots(rules: RobotsRules, path: string): boolean {
  const target = path || "/";

  let bestAllow = -1;
  let bestDisallow = -1;

  for (const pattern of rules.allow) bestAllow = Math.max(bestAllow, matchLength(pattern, target));
  for (const pattern of rules.disallow) {
    // An empty Disallow means "allow everything" and carries no length.
    if (pattern === "") continue;
    bestDisallow = Math.max(bestDisallow, matchLength(pattern, target));
  }

  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}
