import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Minimal PostgREST-shaped stub. Row level security is enforced by Postgres, so
 * these tests model it: the fake returns only rows whose owner matches, exactly
 * as the database would, and asserts the filters the app sends.
 */

export interface RecordedFilter {
  column: string;
  value: unknown;
}

export interface RecordedQuery {
  table: string;
  filters: RecordedFilter[];
}

export interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

export interface StubOptions {
  /** table -> rows visible to the current user. */
  tables?: Record<string, unknown[]>;
  /** rpc name -> rows returned. */
  rpc?: Record<string, unknown[]>;
}

export function createSupabaseStub(options: StubOptions = {}) {
  const queries: RecordedQuery[] = [];
  const rpcs: RecordedRpc[] = [];

  function builder(table: string) {
    const filters: RecordedFilter[] = [];
    const record: RecordedQuery = { table, filters };
    queries.push(record);

    const rows = () => {
      const all = options.tables?.[table] ?? [];
      return all.filter((row) =>
        filters.every(
          (filter) => (row as Record<string, unknown>)[filter.column] === filter.value,
        ),
      );
    };

    const api = {
      select: () => api,
      order: () => api,
      limit: () => api,
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return api;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => {
        const first = rows()[0];
        return first
          ? { data: first, error: null }
          : { data: null, error: { message: "no rows" } };
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve),
    };

    return api;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: options.rpc?.[fn] ?? [], error: null };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    queries,
    rpcs,
  };
}
