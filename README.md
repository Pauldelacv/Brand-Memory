# Brand Memory

Un système de mémoire intelligent pour une marque.

Brand Memory ingests everything a brand knows — guidelines, decks, campaigns,
tone-of-voice documents, visual assets — and turns it into a persistent,
queryable memory. Generation is grounded in that memory, and every answer says
which parts of it were used.

> The AI should understand the brand before creating for the brand.

It has two halves:

```text
INTERNAL MEMORY          EXTERNAL MEMORY
what the brand           what the brand has
says it is               actually said in public
        \                       /
         \                     /
            CROSS ANALYSIS
   consistency · contradictions · drift
   emerging themes · forgotten messages
        tone and positioning over time
```

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
| External      | SSRF-guarded crawler; URL, sitemap, RSS, site connectors |
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
supabase/migrations/0001_init.sql             schema, enums, pgvector indexes
supabase/migrations/0002_rls.sql              row level security, storage bucket + policy
supabase/migrations/0003_retrieval.sql        match_document_chunks, match_memory_entries
supabase/migrations/0004_external_memory.sql  external sources, contents, themes, observations, insights
supabase/migrations/0005_external_rls.sql     row level security for the external half
supabase/migrations/0006_external_retrieval.sql  match_external_chunks, match_external_memory_entries
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

CRON_SECRET=                    # required for the scheduled external sync
# EXTERNAL_FETCH_ENDPOINT=      # optional hosted scraping service
# EXTERNAL_FETCH_API_KEY=
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

## External memory

The internal half records what the brand says about itself. The external half
records what it has actually published — press releases, coverage, interviews,
newsroom and blog posts, web pages — and keeps every statement attached to its
date, so the two can be compared over time.

```text
DISCOVER → FETCH → NORMALISE → DEDUPLICATE → STORE → CHUNK → EMBED → EXTRACT → READY
```

### Acquisition

Four connectors ship in the MVP, behind one `SourceConnector` interface
(`discover`, `fetch`, `normalize`, `extractMetadata`). Only `discover` differs
between them; everything after the URL is shared.

| Connector | What it does |
| --------- | ------------ |
| `URL`     | One page. |
| `SITEMAP` | `sitemap.xml`, newest first, following a sitemap index one level. |
| `RSS`     | RSS 2.0 and Atom. |
| `CRAWL`   | Breadth-first within one site, honouring `robots.txt`, capped at 30 pages per sync. |

Discovery skips URLs the brand already holds before anything is fetched, so a
daily sync costs one request plus whatever is new. Adding Google News, YouTube
or a press database later means adding a `discover` and one enum value.

Page reading is structural, not site-specific: scripts, styles, navigation,
headers, footers and asides are removed, then the block with the highest text
density and the lowest link density wins. Metadata comes from JSON-LD first,
then Open Graph, then meta tags, then the URL.

### Deduplication

The same announcement arrives many times. Rather than merging, it is classified,
and the verdict is kept on the row:

| Verdict | Meaning | Kept in retrieval |
| ------- | ------- | ----------------- |
| `IDENTICAL` | Same canonical URL, same text, or ≥90% overlap. | No |
| `NEAR_DUPLICATE` | ≥60% overlap, same publisher. A reprint. | No |
| `SYNDICATED` | ≥25% overlap, different publisher, brand's own version first. | **Yes** — that is pick-up |
| `DISTINCT` | Genuinely different. | Yes |

Overlap is five-word shingle Jaccard, optionally blended with embedding cosine
for rewrites that share few words. The thresholds are calibrated against the
fixtures in `tests/fixtures/external`, where unrelated brand content overlaps
0.00 and an outlet's write-up of a release overlaps 0.32.

### Data model, and why it is shaped this way

```text
external_feeds            what to watch, and how often
  └── external_sources    one row per URL: status, media class, duplicate verdict
        ├── external_contents   the normalised reading (1:1)
        ├── external_chunks     pgvector passages
        └── external_memory_observations   ← the fact table
                    └── external_memory_entries   themes, counters derived by trigger
brand_insights            cross analysis output
external_analysis_runs    when it last ran, and whether it was complete
```

The observations table is the design decision that matters. A theme is not
stored as a fact about the brand; it is stored as a set of dated observations,
one per (theme, source). `first_seen_at`, `last_seen_at`, `occurrence_count` and
`source_count` are maintained by a trigger over that table, never written by
hand. That is what makes "which messages were dominant in 2022", "what appeared
in 2024" and "what has gone quiet" aggregations rather than claims.

### Extraction

Each content is read once by the LLM, which returns a summary, tone words, a
narrative and a list of themes. The answer is validated with Zod before anything
is written (`externalAnalysisSchema`), and each theme is recorded as an
observation dated to the *publication* date, not the ingestion date. Labels are
normalised so the same message found in nine articles is one theme said nine
times, not nine themes.

### Retrieval

Generation searches both halves in the same pass and ranks them together.
External candidates sit at a `PUBLIC_RECORD` authority tier — above an AI
inference, below the brand's own current sources — and are labelled as public
communication in the context and in the citation panel, with their date and a
link. They never enter conflict resolution: a public statement that disagrees
with the brand memory is a finding, and silently dropping it would hide the
thing worth seeing. Pass `includeExternal: false` to answer from the brand's own
material only.

### Cross analysis

Nine kinds of finding, all produced by a pure function over the two memories
(`src/lib/external/cross-analysis.ts`):

| Kind | Detected when |
| ---- | ------------- |
| `ALIGNED` | An internal claim matches a theme that is actually communicated. |
| `CONTRADICTION` | The two sit on opposite poles of the same axis. |
| `DRIFT` | A matched theme is said much less than it used to be. |
| `FORGOTTEN` | A matched theme was said repeatedly and has gone silent. |
| `MISSING_EXTERNAL` | An internal claim has never reached public communication. |
| `EMERGING` | A theme is new or rising, from several sources, with no internal counterpart. |
| `OVERREPRESENTED` | A theme dominates public communication but is thin internally. |
| `TONE_DRIFT` | The tone distribution moved between the two windows. |
| `POSITIONING_EVOLUTION` | The leading positioning themes changed. |

Contradiction is the one case cosine similarity cannot decide: "premium and
exclusive" and "accessible to everyone" are about the same subject and therefore
*close*. Detection uses an explicit table of opposition axes, and a candidate is
skipped when one side holds both poles — a brand stating a deliberate tension is
not contradicting itself. The shortlist then goes to the model, which can only
confirm or reject; it never introduces a pair. If that review cannot run, the run
completes as `PARTIAL`, keeps the rule-based verdicts, and says so.

### Scoring

Every insight stores its components with their values and weights:

```text
semantic similarity · frequency · recency · source diversity
confidence · internal priority · share of public communication
```

The score is their weighted mean, and the explanation is built from the same
numbers. So a finding reads:

> "sustainability" appears in 17 contents from 9 sources since January 2025,
> against 1 occurrence before that, while the internal memory holds nothing
> closer than "Repairability" at 22%.

Opening "Why" on any finding shows the components behind that sentence. An
unexplainable score would be the one thing this feature must not produce.

### Scheduled sync

`GET /api/cron/external-sync` with `Authorization: Bearer $CRON_SECRET` runs the
watched sources that are due, ingests what is new, and recomputes the insights
for any brand that received content. Ten feeds per invocation. It refuses every
request when `CRON_SECRET` is unset.

On Vercel, add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/external-sync", "schedule": "0 6 * * *" }] }
```

Any scheduler that can issue an authenticated GET works just as well. There is
no queue and no worker fleet: the MVP does not have the volume to justify either,
and this is the first piece that would be replaced if it did.

---

## Security

- Row level security on every table, internal and external, resolving to
  `brands.owner_id = auth.uid()`. External content is fetched from the public
  web, but who watches what — and everything derived from it — is not public.
- Storage objects are keyed `<brandId>/<sourceId>-<filename>` and the storage
  policy checks brand ownership from that path.
- Every server action re-verifies ownership before it acts. Changing an id in a
  URL returns "not found", indistinguishable from a brand that does not exist.
- The service-role client is used only by the ingestion pipeline, after the
  caller has been authorised, and never leaves the server.

Fetching URLs a user supplies is the largest attack surface in the product, and
it is treated as one. Every outbound request passes `assertPublicUrl` (http/https
only, no embedded credentials, standard ports only, no private or reserved
hosts), then resolves the hostname and refuses if *any* answer is a private
address — a public name pointing at `127.0.0.1` or `169.254.169.254` does not get
fetched. Redirects are followed manually and every hop is re-validated, because a
redirect is a new request to a new host. Responses are capped at 2 MB and 15
seconds, and the content type must be something we can actually read. The
`HtmlFetcher` interface means a hosted scraping service can replace the direct
fetcher without any of this moving.

---

## Project layout

```text
src/
├── app/            routes: (auth), dashboard,
│                   brands/[brandId]/{sources,memory,external,generate,settings},
│                   api/cron/external-sync
├── actions/        server actions — auth, brands, sources, memory, chat
├── components/     ui primitives + brand / sources / memory / generation
├── lib/
│   ├── ai/         providers, embeddings, ranking, retrieval, generation, prompts
│   ├── db/         supabase clients, queries with ownership guards, mappers
│   ├── ingestion/  extract, chunk, process, memory extraction
│   ├── external/   url + ssrf guard, fetcher, html, feeds, robots, connectors,
│   │               dedupe, extraction, timeline, cross-analysis, insights
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
validation, and chunking — and, on the external half, URL normalisation and the
SSRF guard, content and metadata extraction, sitemap/feed/robots parsing,
deduplication, temporal aggregation, and every cross-analysis detector.

Fixtures in `tests/fixtures/external` are a realistic shape of the problem: a
press release, an outlet's write-up of that same release, a brand page, and two
contradictory pieces of coverage three years apart.

---

## Known gaps

- Scanned PDFs with no text layer are rejected with a clear message; there is no
  OCR fallback. Images go through the provider's vision model instead.
- Processing is fired off asynchronously from the upload action and the sources
  table polls for status. A job queue is the right answer once documents get big.
- Source priority is per-source. Per-category source priority is a later step.
- Site crawling is capped at 30 pages per sync and does not render JavaScript.
  A site that needs a headless browser needs `EXTERNAL_FETCH_ENDPOINT`.
- Deduplication compares a new content against the 40 most recently stored ones,
  not the whole corpus.
- Cross analysis loads at most 200 entries per memory and compares them in
  process. Past that, the similarity matrix belongs in pgvector.
- Social platforms, video transcripts and press databases are not connectors
  yet. The `SourceConnector` interface is where they go.
- Themes are extracted per content by one LLM call. There is no periodic pass
  that merges two labels which turned out to mean the same thing.
