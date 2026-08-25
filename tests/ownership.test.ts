import { describe, expect, it } from "vitest";
import {
  NotFoundError,
  getOwnedBrand,
  getOwnedConversation,
  getOwnedMemoryEntry,
  getOwnedSource,
  listBrands,
} from "@/lib/db/queries";
import { createSupabaseStub } from "./stubs/supabase";

const OWNED_BRAND = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "user-a",
  name: "Northbound",
  description: "",
  industry: "",
  website: null,
  audience: null,
  positioning: null,
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2025-01-01T00:00:00.000Z",
};

const OTHER_BRAND_ID = "22222222-2222-4222-8222-222222222222";

describe("brand ownership", () => {
  it("loads a brand the caller owns", async () => {
    const { client } = createSupabaseStub({ tables: { brands: [OWNED_BRAND] } });

    await expect(getOwnedBrand(client, OWNED_BRAND.id)).resolves.toMatchObject({
      id: OWNED_BRAND.id,
      name: "Northbound",
    });
  });

  it("refuses a brand id that row level security filtered out", async () => {
    // Another user's brand is simply not in the visible set.
    const { client } = createSupabaseStub({ tables: { brands: [OWNED_BRAND] } });

    await expect(getOwnedBrand(client, OTHER_BRAND_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not distinguish a missing brand from a forbidden one", async () => {
    const { client } = createSupabaseStub({ tables: { brands: [] } });

    await expect(getOwnedBrand(client, OTHER_BRAND_ID)).rejects.toThrow(
      /not found, or you do not have access/,
    );
  });

  it("always filters by the requested id", async () => {
    const { client, queries } = createSupabaseStub({ tables: { brands: [OWNED_BRAND] } });
    await getOwnedBrand(client, OWNED_BRAND.id);

    expect(queries[0]).toMatchObject({
      table: "brands",
      filters: [{ column: "id", value: OWNED_BRAND.id }],
    });
  });

  it("lists only the brands the client can see", async () => {
    const { client } = createSupabaseStub({ tables: { brands: [OWNED_BRAND] } });

    await expect(listBrands(client)).resolves.toHaveLength(1);
  });
});

describe("child resource ownership", () => {
  it("rejects a source that is not visible to the caller", async () => {
    const { client } = createSupabaseStub({ tables: { brand_sources: [] } });

    await expect(getOwnedSource(client, OTHER_BRAND_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a memory entry that is not visible to the caller", async () => {
    const { client } = createSupabaseStub({ tables: { brand_memory_entries: [] } });

    await expect(getOwnedMemoryEntry(client, OTHER_BRAND_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a conversation id lifted from another workspace", async () => {
    const { client } = createSupabaseStub({ tables: { conversations: [] } });

    await expect(getOwnedConversation(client, OTHER_BRAND_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
