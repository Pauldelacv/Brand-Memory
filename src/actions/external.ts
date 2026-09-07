"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/db/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { getOwnedBrand } from "@/lib/db/queries";
import { getOwnedExternalSource, getOwnedFeed, listExternalFeeds } from "@/lib/external/queries";
import {
  describeIngestFailure,
  processExternalSource,
  registerExternalSource,
  syncFeed,
} from "@/lib/external/ingest";
import { extractMissingExternalMemory } from "@/lib/external/extraction";
import { runBrandCrossAnalysis } from "@/lib/external/insights";
import { assertPublicUrl, normalizeUrl } from "@/lib/external/url";
import {
  externalFeedInputSchema,
  externalUrlInputSchema,
  fieldErrors,
  ownedDomainsSchema,
  uuidSchema,
} from "@/lib/validation";
import { describeError, failure } from "@/actions/result";
import type { ActionResult } from "@/actions/result";

/**
 * Server actions for the external half.
 *
 * Every one of them re-verifies brand ownership through the session-scoped
 * client before the service-role client touches anything, and every URL passes
 * the SSRF guard on the server even though the form already checked its shape.
 */

function revalidateExternal(brandId: string): void {
  revalidatePath(`/dashboard/brands/${brandId}/external`);
  revalidatePath(`/dashboard/brands/${brandId}/external/sources`);
  revalidatePath(`/dashboard/brands/${brandId}/external/messages`);
  revalidatePath(`/dashboard/brands/${brandId}/external/timeline`);
  revalidatePath(`/dashboard/brands/${brandId}/external/consistency`);
}

export async function addExternalUrl(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = externalUrlInputSchema.safeParse({
    brandId: formData.get("brandId"),
    url: formData.get("url"),
    sourceType: formData.get("sourceType") || undefined,
  });

  if (!parsed.success) return failure("Check the fields below.", fieldErrors(parsed.error));

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, parsed.data.brandId);

    // The real guard: scheme, credentials, port, private ranges. The form
    // check only covered the shape.
    assertPublicUrl(parsed.data.url);
    const url = normalizeUrl(parsed.data.url);

    const admin = createAdminSupabase();
    const sourceId = await registerExternalSource(
      admin,
      brand,
      {
        url,
        title: null,
        publishedAt: null,
        author: null,
        publisher: null,
        summary: null,
        sourceType: parsed.data.sourceType ?? "WEB_PAGE",
      },
      null,
    );

    // Reading and analysing the page takes longer than a form post should, so
    // it runs after the response and the sources table polls for the status.
    after(async () => {
      await processExternalSource(createAdminSupabase(), brand, sourceId).catch(() => {
        // processExternalSource already records FAILED with a reason.
      });
    });

    revalidateExternal(brand.id);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function createExternalFeed(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = externalFeedInputSchema.safeParse({
    brandId: formData.get("brandId"),
    kind: formData.get("kind"),
    url: formData.get("url"),
    label: formData.get("label") ?? "",
    frequency: formData.get("frequency") ?? "MANUAL",
    maxDocuments: formData.get("maxDocuments") ?? 25,
  });

  if (!parsed.success) return failure("Check the fields below.", fieldErrors(parsed.error));

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, parsed.data.brandId);

    assertPublicUrl(parsed.data.url);
    const url = normalizeUrl(parsed.data.url);

    const { error } = await supabase.from("external_feeds").insert({
      brand_id: brand.id,
      kind: parsed.data.kind,
      url,
      label: parsed.data.label,
      frequency: parsed.data.frequency,
      max_documents: parsed.data.maxDocuments,
    });

    if (error) {
      return failure(
        error.code === "23505"
          ? "That source is already being watched for this brand."
          : "The watched source could not be saved.",
      );
    }

    revalidateExternal(brand.id);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function deleteExternalFeed(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = uuidSchema.safeParse(formData.get("feedId"));
  if (!id.success) return failure("Missing source identifier.");

  try {
    const { supabase } = await requireUser();
    const feed = await getOwnedFeed(supabase, id.data);

    const { error } = await supabase.from("external_feeds").delete().eq("id", feed.id);
    if (error) return failure("The watched source could not be removed.");

    revalidateExternal(feed.brandId);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

const feedToggleSchema = z.object({ feedId: uuidSchema, enabled: z.boolean() });

export async function setExternalFeedEnabled(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = feedToggleSchema.safeParse({
    feedId: formData.get("feedId"),
    enabled: formData.get("enabled") === "on",
  });

  if (!parsed.success) return failure("Missing source identifier.");

  try {
    const { supabase } = await requireUser();
    const feed = await getOwnedFeed(supabase, parsed.data.feedId);

    const { error } = await supabase
      .from("external_feeds")
      .update({ enabled: parsed.data.enabled })
      .eq("id", feed.id);

    if (error) return failure("The watched source could not be updated.");

    revalidateExternal(feed.brandId);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export interface SyncStarted {
  feeds: number;
}

export async function syncExternalFeed(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<SyncStarted>> {
  const id = uuidSchema.safeParse(formData.get("feedId"));
  if (!id.success) return failure("Missing source identifier.");

  try {
    const { supabase } = await requireUser();
    const feed = await getOwnedFeed(supabase, id.data);
    const brand = await getOwnedBrand(supabase, feed.brandId);

    after(async () => {
      await syncFeed(createAdminSupabase(), brand, feed).catch(async (error: unknown) => {
        await createAdminSupabase()
          .from("external_feeds")
          .update({ last_error: describeIngestFailure(error) })
          .eq("id", feed.id);
      });
    });

    revalidateExternal(brand.id);
    return { ok: true, data: { feeds: 1 } };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function syncAllExternalFeeds(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<SyncStarted>> {
  const brandId = uuidSchema.safeParse(formData.get("brandId"));
  if (!brandId.success) return failure("Missing brand identifier.");

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, brandId.data);
    const feeds = (await listExternalFeeds(supabase, brand.id)).filter((feed) => feed.enabled);

    if (feeds.length === 0) {
      return failure("There is nothing to sync. Add a sitemap, a feed or a site to watch first.");
    }

    after(async () => {
      const admin = createAdminSupabase();
      for (const feed of feeds) {
        await syncFeed(admin, brand, feed).catch(async (error: unknown) => {
          await admin
            .from("external_feeds")
            .update({ last_error: describeIngestFailure(error) })
            .eq("id", feed.id);
        });
      }
    });

    revalidateExternal(brand.id);
    return { ok: true, data: { feeds: feeds.length } };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function reprocessExternalSource(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = uuidSchema.safeParse(formData.get("sourceId"));
  if (!id.success) return failure("Missing content identifier.");

  try {
    const { supabase } = await requireUser();
    const source = await getOwnedExternalSource(supabase, id.data);
    const brand = await getOwnedBrand(supabase, source.brandId);

    const result = await processExternalSource(createAdminSupabase(), brand, source.id);

    revalidateExternal(brand.id);

    if (result.status === "FAILED") return failure(result.error ?? "This content could not be read.");
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function deleteExternalSource(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = uuidSchema.safeParse(formData.get("sourceId"));
  if (!id.success) return failure("Missing content identifier.");

  try {
    const { supabase } = await requireUser();
    const source = await getOwnedExternalSource(supabase, id.data);

    // Content, chunks and observations cascade from the foreign keys; the
    // observation trigger updates the theme counters as they go.
    const { error } = await supabase.from("external_sources").delete().eq("id", source.id);
    if (error) return failure("This content could not be removed.");

    revalidateExternal(source.brandId);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}

export interface ExtractionStarted {
  pending: number;
}

export async function runExternalExtraction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ExtractionStarted>> {
  const brandId = uuidSchema.safeParse(formData.get("brandId"));
  if (!brandId.success) return failure("Missing brand identifier.");

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, brandId.data);

    const { count, error } = await supabase
      .from("external_sources")
      .select("id", { count: "exact", head: true })
      .eq("brand_id", brand.id)
      .eq("status", "READY")
      .eq("entry_count", 0);

    if (error) return failure("Could not count the contents awaiting extraction.");

    const pending = count ?? 0;
    if (pending === 0) {
      return failure("Every stored content has already been read into the external memory.");
    }

    after(async () => {
      await extractMissingExternalMemory(createAdminSupabase(), brand).catch(() => {
        // Each failure is recorded on its own source row by the extractor.
      });
    });

    revalidateExternal(brand.id);
    return { ok: true, data: { pending } };
  } catch (error) {
    return failure(describeError(error));
  }
}

export interface ConsistencyResult {
  insightCount: number;
  internalCount: number;
  externalCount: number;
  sourceCount: number;
  status: "OK" | "PARTIAL";
  notes: string;
}

export async function runConsistencyAnalysis(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ConsistencyResult>> {
  const brandId = uuidSchema.safeParse(formData.get("brandId"));
  if (!brandId.success) return failure("Missing brand identifier.");

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, brandId.data);

    const summary = await runBrandCrossAnalysis(createAdminSupabase(), brand);

    revalidateExternal(brand.id);
    revalidatePath(`/dashboard/brands/${brand.id}`);

    return {
      ok: true,
      data: {
        insightCount: summary.insightCount,
        internalCount: summary.internalCount,
        externalCount: summary.externalCount,
        sourceCount: summary.sourceCount,
        status: summary.status,
        notes: summary.notes,
      },
    };
  } catch (error) {
    return failure(describeError(error));
  }
}

export async function updateOwnedDomains(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const brandId = uuidSchema.safeParse(formData.get("brandId"));
  if (!brandId.success) return failure("Missing brand identifier.");

  const parsed = ownedDomainsSchema.safeParse(formData.get("ownedDomains") ?? "");
  if (!parsed.success) return failure("Those domains are not valid.");

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, brandId.data);

    const { error } = await supabase
      .from("brands")
      .update({ owned_domains: parsed.data })
      .eq("id", brand.id);

    if (error) return failure("The domains could not be saved.");

    revalidateExternal(brand.id);
    revalidatePath(`/dashboard/brands/${brand.id}/settings`);
    return { ok: true };
  } catch (error) {
    return failure(describeError(error));
  }
}
