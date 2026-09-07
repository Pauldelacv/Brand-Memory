import { afterEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/db/queries";
import { setAIProvider } from "@/lib/ai";
import { hashEmbedding } from "@/lib/ai/providers/local";
import { retrieveExternalCandidates } from "@/lib/external/retrieval";
import {
  getOwnedExternalSource,
  getOwnedFeed,
  listExternalMemoryEntries,
  listExternalSources,
  listObservationPoints,
} from "@/lib/external/queries";
import { createSupabaseStub } from "./stubs/supabase";

/**
 * External content is fetched from the public web, but who watches what — and
 * everything derived from it — is not public. These mirror the internal
 * ownership tests: the client only ever sees its own brand's rows, and every
 * query says which brand it means.
 */

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => setAIProvider(null));

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

describe("external ownership", () => {
  it("refuses a watched source that row level security filtered out", async () => {
    const { client } = createSupabaseStub({ tables: { external_feeds: [] } });

    await expect(getOwnedFeed(client, BRAND_B)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses an external content id lifted from another workspace", async () => {
    const { client } = createSupabaseStub({ tables: { external_sources: [] } });

    await expect(getOwnedExternalSource(client, BRAND_B)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not distinguish a missing content from a forbidden one", async () => {
    const { client } = createSupabaseStub({ tables: { external_sources: [] } });

    await expect(getOwnedExternalSource(client, BRAND_B)).rejects.toThrow(
      /not found, or you do not have access/,
    );
  });
});

describe("brand isolation", () => {
  it("filters every external listing by the requested brand", async () => {
    const { client, queries } = createSupabaseStub({
      tables: { external_sources: [], external_contents: [], external_memory_observations: [], external_memory_entries: [] },
    });

    await listExternalSources(client, BRAND_A);

    const tables = queries.map((query) => query.table);
    expect(tables).toContain("external_sources");
    expect(tables).toContain("external_contents");
    for (const query of queries) {
      expect(query.filters).toContainEqual({ column: "brand_id", value: BRAND_A });
    }
  });

  it("filters the external memory by brand, and by kind when asked", async () => {
    const { client, queries } = createSupabaseStub({ tables: { external_memory_entries: [] } });

    await listExternalMemoryEntries(client, BRAND_A, "POSITIONING");

    expect(queries[0]?.filters).toEqual([
      { column: "brand_id", value: BRAND_A },
      { column: "kind", value: "POSITIONING" },
    ]);
  });

  it("only builds timeline points from themes belonging to the same brand", async () => {
    // Defence in depth: row level security already scopes both tables, and the
    // join is still refused rather than resolved across brands.
    const { client } = createSupabaseStub({
      tables: {
        external_memory_observations: [
          { brand_id: BRAND_A, entry_id: "theme-a", source_id: "source-1", observed_at: "2025-01-01T00:00:00.000Z" },
          { brand_id: BRAND_A, entry_id: "theme-of-another-brand", source_id: "source-2", observed_at: "2025-01-02T00:00:00.000Z" },
        ],
        external_memory_entries: [{ brand_id: BRAND_A, id: "theme-a", label: "durability", kind: "MESSAGE" }],
      },
    });

    const points = await listObservationPoints(client, BRAND_A);

    expect(points).toHaveLength(1);
    expect(points[0]?.label).toBe("durability");
  });
});

describe("external retrieval", () => {
  it("scopes both external searches to the requested brand", async () => {
    installProvider();
    const { client, rpcs } = createSupabaseStub({
      rpc: { match_external_memory_entries: [], match_external_chunks: [] },
    });

    await retrieveExternalCandidates(client, BRAND_A, hashEmbedding("tone"));

    expect(rpcs.map((rpc) => rpc.fn).sort()).toEqual([
      "match_external_chunks",
      "match_external_memory_entries",
    ]);
    for (const rpc of rpcs) {
      expect(rpc.args.p_brand_id).toBe(BRAND_A);
    }
  });

  it("labels public content as public and carries its date and link", async () => {
    installProvider();
    const { client } = createSupabaseStub({
      rpc: {
        match_external_memory_entries: [
          {
            id: "theme-1",
            kind: "POSITIONING",
            label: "accessible to everyone",
            title: "Accessible to everyone",
            content: "An affordable frame for commuters.",
            confidence: 0.8,
            first_seen_at: "2025-01-01T00:00:00.000Z",
            last_seen_at: "2025-11-01T00:00:00.000Z",
            occurrence_count: 12,
            source_count: 7,
            updated_at: "2025-11-02T00:00:00.000Z",
            similarity: 0.7,
          },
        ],
        match_external_chunks: [
          {
            id: "chunk-1",
            source_id: "source-1",
            content: "Velvire is accessible to everyone.",
            published_at: "2025-06-18T00:00:00.000Z",
            metadata: {
              title: "Velvire wants to be a bike for everyone",
              publisher: "Frame Quarterly",
              url: "https://framequarterly.example.com/velvire",
            },
            similarity: 0.66,
          },
        ],
      },
    });

    const candidates = await retrieveExternalCandidates(client, BRAND_A, hashEmbedding("positioning"));

    const theme = candidates.find((candidate) => candidate.kind === "EXTERNAL_MEMORY");
    const passage = candidates.find((candidate) => candidate.kind === "EXTERNAL_DOCUMENT");

    // The counts belong in the context: a recurring position and a one-off
    // quote should not read the same to the model.
    expect(theme?.content).toContain("said in 12 public contents across 7 sources");
    expect(passage?.sourceName).toBe("Frame Quarterly");
    expect(passage?.url).toBe("https://framequarterly.example.com/velvire");
    expect(passage?.publishedAt).toBe("2025-06-18T00:00:00.000Z");
  });
});
