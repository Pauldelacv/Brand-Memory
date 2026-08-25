import Link from "next/link";
import { requireUser } from "@/lib/db/server";
import {
  getOwnedConversation,
  listConversations,
  listMemoryEntries,
  listMessages,
  listSources,
} from "@/lib/db/queries";
import { GenerateWorkspace } from "@/components/generation/generate-workspace";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/types/domain";

export default async function GeneratePage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ brandId }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireUser();

  const [conversations, sources, memory] = await Promise.all([
    listConversations(supabase, brandId),
    listSources(supabase, brandId),
    listMemoryEntries(supabase, brandId),
  ]);

  const requested = query.c ?? null;
  let activeId: string | null = null;
  let messages: ChatMessage[] = [];

  if (requested) {
    // Ownership is re-checked here: a conversation id from the URL is untrusted.
    const conversation = await getOwnedConversation(supabase, requested);
    activeId = conversation.id;
    messages = await listMessages(supabase, conversation.id);
  }

  const indexedPassages = sources.reduce((sum, source) => sum + source.chunkCount, 0);
  const hasKnowledge = indexedPassages > 0 || memory.length > 0;
  const base = `/dashboard/brands/${brandId}/generate`;

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-6">
        <Panel className="h-fit">
          <PanelHeader title="Conversations" />
          <ul className="divide-y divide-rule">
            <li>
              <Link
                href={base}
                className={cn(
                  "block px-4 py-2.5 text-xs hover:bg-paper",
                  activeId === null ? "bg-paper font-medium text-ink" : "text-ink-muted",
                )}
              >
                New conversation
              </Link>
            </li>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`${base}?c=${conversation.id}`}
                  className={cn(
                    "block px-4 py-2.5 text-xs hover:bg-paper",
                    activeId === conversation.id
                      ? "bg-paper font-medium text-ink"
                      : "text-ink-muted",
                  )}
                >
                  <span className="line-clamp-2">{conversation.title}</span>
                  <span className="mt-1 block font-mono text-[0.6875rem] text-ink-faint">
                    {new Date(conversation.updatedAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="h-fit">
          <PanelHeader title="Context available" />
          <dl className="divide-y divide-rule">
            {[
              ["Memory entries", memory.length],
              ["Indexed passages", indexedPassages],
              ["Sources ready", sources.filter((source) => source.status === "READY").length],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5">
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="font-mono text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </aside>

      <GenerateWorkspace
        key={activeId ?? "new"}
        brandId={brandId}
        conversationId={activeId}
        initialMessages={messages}
        hasKnowledge={hasKnowledge}
      />
    </div>
  );
}
