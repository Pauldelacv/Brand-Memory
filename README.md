# Brand Memory

Un système de mémoire intelligent pour une marque.

Brand Memory ingests everything a brand knows — guidelines, decks, campaigns,
tone-of-voice documents, visual assets — and turns it into a persistent,
queryable memory. Generation is grounded in that memory, and every answer says
which parts of it were used.

> The AI should understand the brand before creating for the brand.

---

## Stack

| Layer         | Choice                                             |
| ------------- | -------------------------------------------------- |
| Framework     | Next.js (App Router), React, TypeScript strict      |
| Styling       | Tailwind CSS v4                                     |
| Database      | Postgres via Supabase                               |
| Vector search | pgvector, HNSW cosine index, 1536 dimensions        |
| Storage       | Supabase Storage (`brand-sources` bucket)           |
| Auth          | Supabase Auth (email + password)                    |
| AI            | Provider-agnostic — Anthropic, OpenAI, or local     |
| Tests         | Vitest                                              |

There is no separate backend service and no separate vector database. Retrieval
runs inside Postgres.

---

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

### 1. Supabase

Create a project, then run the migrations in order against its database:

```
supabase/migrations/0001_init.sql       schema, enums, pgvector indexes
supabase/migrations/0002_rls.sql        row level security, storage bucket + policy
supabase/migrations/0003_retrieval.sql  match_document_chunks, match_memory_entries
```

Either paste them into the SQL editor, or run `supabase db push` if you use the
CLI. `0002_rls.sql` creates the `brand-sources` storage bucket, so no manual
bucket setup is needed.

### 2. Environment

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server only, never sent to the browser

AI_TEXT_PROVIDER=anthropic      # anthropic | openai
AI_EMBEDDING_PROVIDER=openai    # openai | local

ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

Anthropic has no embeddings endpoint, so text and embeddings are resolved
separately and presented behind one `AIProvider`. `AI_EMBEDDING_PROVIDER=local`
uses deterministic hashed embeddings — useful for developing without an API key,
but recall is far below a real model, so do not ship it.

---

## How it works

```text
UPLOAD → VALIDATE → EXTRACT → CHUNK → EMBED → STORE → READY
```

Each upload becomes a `BrandSource` with a visible status (`UPLOADED`,
`PROCESSING`, `READY`, `FAILED`) and, when it fails, the reason. The original
file stays linked to everything derived from it, so any claim can be traced back
to the document it came from.

Generation:

```text
PROMPT → EMBED → SEARCH MEMORY + DOCUMENTS → RANK → RESOLVE CONFLICTS
       → SELECTIVE CONTEXT → LLM → ANSWER + SOURCES
```

### Two layers of memory

Vector search over document chunks is only half of it. The structured layer —
`brand_memory_entries` — holds extracted claims under nine categories (identity,
positioning, audience, personality, voice, visual language, values, products,
creative history). Both layers are searched, then ranked together.

Extracted entries are suggestions. Editing one promotes it to the top of the
conflict ladder and it is never overwritten by a later extraction.

### Conflict resolution

Sources contradict each other. Brand Memory does not merge them silently:

```text
1. Memory a person edited
2. Newest official source
3. Other sources, by priority
4. AI inference
```

Two entries in the same category with the same title are treated as competing
claims about the same thing. The winner goes into the context, the loser is
reported as a contradiction, and the model is told to say which position it used.
See `src/lib/ai/ranking.ts`.

### Attribution

Every assistant message stores the retrieval trace that produced it. The
generation screen lists the sources used, their relevance, and the exact excerpt
that reached the model. This is a product principle, not a debug view.

---

## Security

- Row level security on every table, resolving to `brands.owner_id = auth.uid()`.
- Storage objects are keyed `<brandId>/<sourceId>-<filename>` and the storage
  policy checks brand ownership from that path.
- Every server action re-verifies ownership before it acts. Changing an id in a
  URL returns "not found", indistinguishable from a brand that does not exist.
- The service-role client is used only by the ingestion pipeline, after the
  caller has been authorised, and never leaves the server.

---

## Project layout

```text
src/
├── app/            routes: (auth), dashboard, brands/[brandId]/{sources,memory,generate,settings}
├── actions/        server actions — auth, brands, sources, memory, chat
├── components/     ui primitives + brand / sources / memory / generation
├── lib/
│   ├── ai/         providers, embeddings, ranking, retrieval, generation, prompts
│   ├── db/         supabase clients, queries with ownership guards, mappers
│   ├── ingestion/  extract, chunk, process, memory extraction
│   └── validation  zod schemas for forms, API input and AI output
└── types/          domain + database row types

supabase/migrations/   schema, RLS, retrieval functions
tests/                 vitest
```

---

## Commands

```bash
npm run dev         # development server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
```

Tests cover the priorities that matter most here: retrieval ranking, conflict
resolution, source ownership and brand isolation, structured AI output
validation, and chunking.

---

## Known gaps

- Scanned PDFs with no text layer are rejected with a clear message; there is no
  OCR fallback. Images go through the provider's vision model instead.
- Processing is fired off asynchronously from the upload action and the sources
  table polls for status. A job queue is the right answer once documents get big.
- Source priority is per-source. Per-category source priority is a later step.
