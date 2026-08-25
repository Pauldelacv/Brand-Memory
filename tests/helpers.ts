import type { RetrievalCandidate } from "@/lib/ai/ranking";

export function candidate(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    kind: "DOCUMENT",
    refId: crypto.randomUUID(),
    label: "Brand Guidelines 2025.pdf",
    content: "The brand speaks with confidence and restraint.",
    similarity: 0.5,
    sourceId: "source-1",
    sourceName: "Brand Guidelines 2025.pdf",
    category: null,
    origin: null,
    authoritative: false,
    sourceDate: null,
    priority: 0,
    updatedAt: null,
    ...overrides,
  };
}

export function memoryCandidate(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return candidate({
    kind: "MEMORY",
    sourceId: null,
    sourceName: null,
    category: "VOICE",
    origin: "AI_EXTRACTED",
    label: "Tone of voice",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  });
}
