"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/actions/chat";
import { CitationList } from "@/components/generation/citation-list";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Tag } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { GENERATION_MODES, GENERATION_MODE_LABELS } from "@/types/domain";
import type { ChatMessage, GenerationMode } from "@/types/domain";

const MODE_HINTS: Record<GenerationMode, string> = {
  ASK: "Ask a direct question about the brand.",
  CREATE: "Produce campaign work: concept, rationale, messaging, tone, visual direction.",
  EXPLORE: "Open up several distinct creative territories.",
  COMPARE: "Weigh options against the brand's positioning, audience and voice.",
};

const STARTERS: Record<GenerationMode, string[]> = {
  ASK: ["What is the personality of this brand?", "What language should we never use?"],
  CREATE: ["Create a launch campaign for our new electric bike.", "How would this brand describe a new product?"],
  EXPLORE: ["Generate three creative territories for a summer campaign."],
  COMPARE: ["Compare a price-led launch against a design-led launch for this brand."],
};

export function GenerateWorkspace({
  brandId,
  conversationId,
  initialMessages,
  hasKnowledge,
}: {
  brandId: string;
  conversationId: string | null;
  initialMessages: ChatMessage[];
  hasKnowledge: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [activeConversation, setActiveConversation] = useState<string | null>(conversationId);
  const [mode, setMode] = useState<GenerationMode>("ASK");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const promptRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const trimmed = prompt.trim();
    if (trimmed.length < 3 || isPending) return;

    setError(null);
    setConflicts([]);

    const formData = new FormData();
    formData.set("brandId", brandId);
    formData.set("mode", mode);
    formData.set("prompt", trimmed);
    if (activeConversation) formData.set("conversationId", activeConversation);

    startTransition(async () => {
      const result = await sendMessage(null, formData);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setMessages((current) => [...current, result.data.userMessage, result.data.assistantMessage]);
      setActiveConversation(result.data.conversationId);
      setConflicts(result.data.conflicts);
      setPrompt("");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule pb-4">
        {GENERATION_MODES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={cn(
              "border px-3 py-1.5 text-xs transition-colors",
              mode === option
                ? "border-ink bg-ink text-paper"
                : "border-rule bg-surface text-ink-muted hover:border-ink hover:text-ink",
            )}
          >
            {GENERATION_MODE_LABELS[option]}
          </button>
        ))}
        <p className="ml-2 text-xs text-ink-faint">{MODE_HINTS[mode]}</p>
      </div>

      <div className="flex-1 space-y-6 py-6">
        {messages.length === 0 ? (
          <div className="max-w-xl">
            <p className="font-serif text-2xl text-ink">
              {hasKnowledge
                ? "Ask the brand something."
                : "This brand has no knowledge yet."}
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              {hasKnowledge
                ? "Every answer is assembled from the retrieved memory and lists the sources it used."
                : "Upload sources and run extraction first. Without memory, answers would be generic — which is the thing this tool exists to avoid."}
            </p>

            {hasKnowledge ? (
              <ul className="mt-5 space-y-2">
                {STARTERS[mode].map((starter) => (
                  <li key={starter}>
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(starter);
                        promptRef.current?.focus();
                      }}
                      className="text-left text-sm text-signal underline underline-offset-4"
                    >
                      {starter}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-2xl border border-rule bg-surface px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Tag>{GENERATION_MODE_LABELS[message.mode]}</Tag>
                  </div>
                  <p className="mt-2 text-sm whitespace-pre-wrap text-ink">{message.content}</p>
                </div>
              </div>
            ) : (
              <article key={message.id} className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <div className="prose-answer whitespace-pre-wrap text-ink">{message.content}</div>
                <aside className="lg:border-l lg:border-rule lg:pl-5">
                  <CitationList citations={message.retrieval} />
                </aside>
              </article>
            ),
          )
        )}

        {isPending ? (
          <p className="label animate-pulse">Retrieving brand memory and generating…</p>
        ) : null}

        {conflicts.length > 0 ? (
          <div className="border border-warning bg-surface px-4 py-3">
            <p className="label text-warning">Sources disagree</p>
            <ul className="mt-2 space-y-1">
              {conflicts.map((conflict) => (
                <li key={conflict} className="text-xs leading-relaxed text-ink-muted">
                  {conflict}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p className="border border-critical bg-surface px-4 py-3 text-xs text-critical">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t border-rule bg-paper pt-4 pb-6">
        <Textarea
          ref={promptRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          rows={3}
          maxLength={4000}
          placeholder={STARTERS[mode][0]}
          className="bg-surface"
        />
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-xs text-ink-faint">⌘↵ to send</p>
          <Button onClick={submit} disabled={isPending || prompt.trim().length < 3}>
            {isPending ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
