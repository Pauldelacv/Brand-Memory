import { afterEach, describe, expect, it } from "vitest";
import { setAIProvider } from "@/lib/ai";
import { retrieveBrandContext } from "@/lib/ai/retrieval";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import { hashEmbedding } from "@/lib/ai/providers/local";
import { createSupabaseStub } from "./stubs/supabase";

const BRAND_A = "11111111-1111-4111-8111-111111111111";

function installProvider() {
  setAIProvider({
    name: "test",
    async generateEmbedding(input: string) {
      return hashEmbedding(input);
    },
    async generateText() {
      return { text: "unused", model: "test" };
    },
  });
}

afterEach(() => setAIProvider(null));

describe("brand isolation in retrieval", () => {
  it("scopes every vector search, internal and external, to the requested brand", async () => {
    installProvider();
    const { client, rpcs, queries } = createSupabaseStub({
      tables: { brand_sources: [] },
      rpc: {
        match_memory_entries: [],
        match_document_chunks: [],
        match_external_memory_entries: [],
        match_external_chunks: [],
      },
    });

    await retrieveBrandContext(client, BRAND_A, "What is our tone of voice?");

    expect(rpcs.map((rpc) => rpc.fn).sort()).toEqual([
      "match_document_chunks",
      "match_external_chunks",
      "match_external_memory_entries",
      "match_memory_entries",
    ]);
    // The brand filter is the only thing standing between two tenants' public
    // records, so it is asserted on every call rather than on the first.
    for (const rpc of rpcs) {
      expect(rpc.args.p_brand_id).toBe(BRAND_A);
    }
    expect(queries).toContainEqual({
      table: "brand_sources",
      filters: [{ column: "brand_id", value: BRAND_A }],
    });
  });

  it("can answer from the brand's own material only", async () => {
    installProvider();
    const { client, rpcs } = createSupabaseStub({
      tables: { brand_sources: [] },
      rpc: { match_memory_entries: [], match_document_chunks: [] },
    });

    await retrieveBrandContext(client, BRAND_A, "tone", { includeExternal: false });

    expect(rpcs.map((rpc) => rpc.fn).sort()).toEqual([
      "match_document_chunks",
      "match_memory_entries",
    ]);
  });

  it("sends an embedding of the expected width to pgvector", async () => {
    installProvider();
    const { client, rpcs } = createSupabaseStub({
      rpc: { match_memory_entries: [], match_document_chunks: [] },
    });

    await retrieveBrandContext(client, BRAND_A, "positioning");

    expect((rpcs[0]?.args.p_query_embedding as number[]).length).toBe(EMBEDDING_DIMENSIONS);
  });
});

describe("retrieval output", () => {
  it("merges memory and document hits into one attributed context", async () => {
    installProvider();
    const { client } = createSupabaseStub({
      tables: {
        brand_sources: [
          {
            id: "source-1",
            brand_id: BRAND_A,
            filename: "Brand Guidelines 2025.pdf",
            authoritative: true,
            priority: 3,
            source_date: "2025-01-01",
          },
        ],
      },
      rpc: {
        match_memory_entries: [
          {
            id: "memory-1",
            category: "VOICE",
            title: "Tone of voice",
            content: "Confident and restrained.",
            source_references: [],
            confidence: 0.9,
            origin: "USER_EDITED",
            updated_at: "2025-06-01T00:00:00.000Z",
            similarity: 0.71,
          },
        ],
        match_document_chunks: [
          {
            id: "chunk-1",
            source_id: "source-1",
            content: "We write in short, declarative sentences.",
            metadata: {},
            similarity: 0.64,
          },
        ],
      },
    });

    const context = await retrieveBrandContext(client, BRAND_A, "How do we write?");

    expect(context.citations).toHaveLength(2);
    expect(context.citations.find((citation) => citation.kind === "DOCUMENT")?.sourceName).toBe(
      "Brand Guidelines 2025.pdf",
    );
    expect(context.text).toContain("Tone of voice");
    expect(context.text).toContain("Brand Guidelines 2025.pdf");
  });

  it("carries source trust settings into the ranking", async () => {
    installProvider();
    const { client } = createSupabaseStub({
      tables: {
        brand_sources: [
          {
            id: "official",
            brand_id: BRAND_A,
            filename: "Strategy 2025.pdf",
            authoritative: true,
            priority: 5,
            source_date: "2025-01-01",
          },
          {
            id: "casual",
            brand_id: BRAND_A,
            filename: "Random notes.txt",
            authoritative: false,
            priority: 0,
            source_date: "2020-01-01",
          },
        ],
      },
      rpc: {
        match_memory_entries: [],
        match_document_chunks: [
          {
            id: "chunk-casual",
            source_id: "casual",
            content: "Tone is playful and loud.",
            metadata: {},
            similarity: 0.68,
          },
          {
            id: "chunk-official",
            source_id: "official",
            content: "Tone is confident and restrained.",
            metadata: {},
            similarity: 0.62,
          },
        ],
      },
    });

    const context = await retrieveBrandContext(client, BRAND_A, "tone");

    expect(context.candidates[0]?.refId).toBe("chunk-official");
  });
});
