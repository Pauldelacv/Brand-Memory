import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { serverEnv } from "@/lib/env";
import { toBrand } from "@/lib/db/mappers";
import { describeIngestFailure, syncFeed } from "@/lib/external/ingest";
import { toExternalFeed } from "@/lib/external/mappers";
import { runBrandCrossAnalysis } from "@/lib/external/insights";
import type { BrandRow, ExternalFeedRow } from "@/types/database";

/**
 * Scheduled external sync.
 *
 *   crawl the watched sources → discover new URLs → ignore known ones →
 *   read the new content → extract external memory → recompute the insights
 *
 * One cron endpoint, no queue and no worker fleet: the MVP does not have the
 * volume to justify either, and this is the piece that would be replaced first
 * if it did. Vercel Cron, GitHub Actions or any scheduler that can issue an
 * authenticated GET will drive it.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Feeds handled per invocation, so one run cannot outgrow its time budget. */
const MAX_FEEDS_PER_RUN = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

function isDue(frequency: string, lastSyncedAt: string | null, now: number): boolean {
  if (frequency === "MANUAL") return false;
  if (!lastSyncedAt) return true;

  const elapsed = now - Date.parse(lastSyncedAt);
  if (!Number.isFinite(elapsed)) return true;

  return frequency === "DAILY" ? elapsed >= DAY_MS : elapsed >= 7 * DAY_MS;
}

export async function GET(request: NextRequest) {
  const secret = serverEnv.cronSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured, so the scheduled sync is disabled." },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const now = Date.now();

  const { data: feedRows, error: feedError } = await admin
    .from("external_feeds")
    .select("*")
    .eq("enabled", true)
    .neq("frequency", "MANUAL")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(MAX_FEEDS_PER_RUN * 3);

  if (feedError) {
    return NextResponse.json({ error: "The watched sources could not be read." }, { status: 500 });
  }

  const due = (feedRows as ExternalFeedRow[])
    .map(toExternalFeed)
    .filter((feed) => isDue(feed.frequency, feed.lastSyncedAt, now))
    .slice(0, MAX_FEEDS_PER_RUN);

  const results: Array<{ feedId: string; brandId: string; ingested?: number; error?: string }> = [];
  const touchedBrands = new Set<string>();

  for (const feed of due) {
    const { data: brandRow, error: brandError } = await admin
      .from("brands")
      .select("*")
      .eq("id", feed.brandId)
      .maybeSingle();

    if (brandError || !brandRow) {
      results.push({ feedId: feed.id, brandId: feed.brandId, error: "The brand could not be loaded." });
      continue;
    }

    const brand = toBrand(brandRow as BrandRow);

    try {
      const summary = await syncFeed(admin, brand, feed);
      results.push({ feedId: feed.id, brandId: brand.id, ingested: summary.ingested });
      if (summary.ingested > 0) touchedBrands.add(brand.id);
    } catch (error) {
      results.push({ feedId: feed.id, brandId: brand.id, error: describeIngestFailure(error) });
    }
  }

  // New public content changes the answer to "does what we say match what we
  // said", so the insights are recomputed for the brands that received some.
  const recomputed: string[] = [];
  for (const brandId of touchedBrands) {
    const { data: brandRow } = await admin.from("brands").select("*").eq("id", brandId).maybeSingle();
    if (!brandRow) continue;

    try {
      await runBrandCrossAnalysis(admin, toBrand(brandRow as BrandRow));
      recomputed.push(brandId);
    } catch {
      // The sync itself succeeded; the analysis can be re-run from the UI.
    }
  }

  return NextResponse.json({
    checked: due.length,
    results,
    recomputed,
  });
}
