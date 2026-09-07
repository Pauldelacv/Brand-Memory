"use client";

import { useActionState } from "react";
import {
  deleteExternalFeed,
  setExternalFeedEnabled,
  syncAllExternalFeeds,
  syncExternalFeed,
} from "@/actions/external";
import type { SyncStarted } from "@/actions/external";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/panel";
import { Tag } from "@/components/ui/status";
import { CONNECTOR_KIND_LABELS } from "@/types/external";
import type { ExternalFeed } from "@/types/external";
import type { ActionResult } from "@/actions/result";

export function FeedList({ brandId, feeds }: { brandId: string; feeds: ExternalFeed[] }) {
  const [syncState, syncAllAction] = useActionState<ActionResult<SyncStarted> | null, FormData>(
    syncAllExternalFeeds,
    null,
  );

  if (feeds.length === 0) {
    return (
      <EmptyState
        title="Nothing is being watched"
        description="Add the brand's sitemap, its newsroom feed, or the site itself. Sync discovers new URLs and skips the ones already read."
      />
    );
  }

  return (
    <div>
      <ul className="divide-y divide-rule">
        {feeds.map((feed) => (
          <FeedRow key={feed.id} feed={feed} />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule px-5 py-3">
        <form action={syncAllAction}>
          <input type="hidden" name="brandId" value={brandId} />
          <Button type="submit" size="sm" variant="secondary">
            Sync everything
          </Button>
        </form>

        {syncState && !syncState.ok ? (
          <p className="text-xs text-critical">{syncState.error}</p>
        ) : null}
        {syncState?.ok ? (
          <p className="text-xs text-ink-muted">
            Syncing {syncState.data.feeds} source{syncState.data.feeds === 1 ? "" : "s"} in the
            background. New content appears in the table as it is read.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FeedRow({ feed }: { feed: ExternalFeed }) {
  const [syncState, syncAction] = useActionState<ActionResult<SyncStarted> | null, FormData>(
    syncExternalFeed,
    null,
  );
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(
    deleteExternalFeed,
    null,
  );
  const [toggleState, toggleAction] = useActionState<ActionResult | null, FormData>(
    setExternalFeedEnabled,
    null,
  );

  const error =
    (syncState && !syncState.ok && syncState.error) ||
    (deleteState && !deleteState.ok && deleteState.error) ||
    (toggleState && !toggleState.ok && toggleState.error) ||
    null;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{CONNECTOR_KIND_LABELS[feed.kind]}</Tag>
            {feed.frequency !== "MANUAL" ? <Tag>{feed.frequency.toLowerCase()}</Tag> : null}
            {!feed.enabled ? <Tag className="border-rule-strong text-ink-faint">paused</Tag> : null}
          </div>

          <p className="mt-2 text-sm text-ink">{feed.label || feed.url}</p>
          <p className="mt-0.5 truncate font-mono text-[0.6875rem] text-ink-faint">{feed.url}</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint">
            {feed.lastSyncedAt
              ? `Last sync ${new Date(feed.lastSyncedAt).toLocaleString()} · ${feed.discoveredCount} contents read`
              : "Never synced"}
          </p>

          {feed.lastError ? <p className="mt-1.5 text-xs text-critical">{feed.lastError}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <form action={syncAction}>
            <input type="hidden" name="feedId" value={feed.id} />
            <Button type="submit" variant="secondary" size="sm">
              Sync
            </Button>
          </form>

          <form action={toggleAction}>
            <input type="hidden" name="feedId" value={feed.id} />
            {!feed.enabled ? <input type="hidden" name="enabled" value="on" /> : null}
            <Button type="submit" variant="ghost" size="sm">
              {feed.enabled ? "Pause" : "Resume"}
            </Button>
          </form>

          <form action={deleteAction}>
            <input type="hidden" name="feedId" value={feed.id} />
            <Button type="submit" variant="ghost" size="sm" className="text-critical">
              Remove
            </Button>
          </form>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
      {syncState?.ok ? (
        <p className="mt-2 text-xs text-ink-muted">Sync started in the background.</p>
      ) : null}
    </li>
  );
}
