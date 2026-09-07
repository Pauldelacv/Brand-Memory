-- External Brand Memory — what the brand has actually said in public.
--
-- The internal memory (0001) holds what the brand says it is. This half holds
-- what it published, keeps the original alongside the normalised text, and is
-- built around time: every structured theme is backed by dated observations, so
-- "which messages were dominant in 2022" is an aggregation rather than a reread.

create type external_connector_kind as enum ('URL', 'SITEMAP', 'RSS', 'CRAWL');

create type external_sync_frequency as enum ('MANUAL', 'DAILY', 'WEEKLY');

create type external_source_type as enum (
  'PRESS_RELEASE',
  'ARTICLE',
  'INTERVIEW',
  'WEB_PAGE',
  'BLOG_POST',
  'NEWSROOM',
  'VIDEO',
  'SOCIAL_POST',
  'MANUAL',
  'OTHER'
);

-- DUPLICATE is a terminal state like FAILED: the content was fetched, then
-- recognised as something the brand memory already holds.
create type external_status as enum (
  'DISCOVERED',
  'FETCHING',
  'PROCESSING',
  'READY',
  'FAILED',
  'DUPLICATE'
);

-- Published on a domain the brand owns, or covered by someone else.
-- Source diversity in the scoring leans on this distinction.
create type external_media_class as enum ('OWNED', 'EARNED', 'UNKNOWN');

create type external_memory_kind as enum (
  'IDENTITY',
  'POSITIONING',
  'AUDIENCE',
  'PERSONALITY',
  'VOICE',
  'VALUES',
  'PRODUCT',
  'SERVICE',
  'MESSAGE',
  'CLAIM',
  'TOPIC',
  'NARRATIVE',
  'SPOKESPERSON',
  'CREATIVE_THEME',
  'STRATEGIC_THEME'
);

create type brand_insight_kind as enum (
  'ALIGNED',
  'CONTRADICTION',
  'DRIFT',
  'EMERGING',
  'OVERREPRESENTED',
  'MISSING_EXTERNAL',
  'FORGOTTEN',
  'TONE_DRIFT',
  'POSITIONING_EVOLUTION'
);

-- Domains the brand publishes on itself. Doubles as the crawler allowlist and
-- as the owned/earned split used by source-diversity scoring.
alter table brands add column owned_domains text[] not null default '{}'::text[];

create table external_feeds (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  kind external_connector_kind not null,
  url text not null,
  label text not null default '',
  enabled boolean not null default true,
  frequency external_sync_frequency not null default 'MANUAL',
  max_documents int not null default 25 check (max_documents between 1 and 200),
  last_synced_at timestamptz,
  last_error text,
  discovered_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, kind, url)
);

create index external_feeds_brand_id_idx on external_feeds (brand_id, created_at desc);
create index external_feeds_due_idx on external_feeds (enabled, frequency, last_synced_at);

create table external_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  feed_id uuid references external_feeds (id) on delete set null,
  source_type external_source_type not null default 'WEB_PAGE',
  media_class external_media_class not null default 'UNKNOWN',
  url text not null,
  canonical_url text,
  -- sha256 of the normalised canonical URL: the first line of deduplication.
  url_hash text not null,
  content_hash text,
  status external_status not null default 'DISCOVERED',
  extraction_error text,
  duplicate_of uuid references external_sources (id) on delete set null,
  duplicate_kind text,
  duplicate_similarity real,
  discovered_at timestamptz not null default now(),
  fetched_at timestamptz,
  processed_at timestamptz,
  chunk_count int not null default 0,
  entry_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, url_hash)
);

create index external_sources_brand_id_idx on external_sources (brand_id, discovered_at desc);
create index external_sources_status_idx on external_sources (brand_id, status);
create index external_sources_content_hash_idx on external_sources (brand_id, content_hash);

-- The normalised reading of a source. Kept apart from the source row so a
-- re-fetch replaces the content without losing the acquisition record.
create table external_contents (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  source_id uuid not null unique references external_sources (id) on delete cascade,
  title text not null default '',
  body text not null,
  summary text not null default '',
  author text,
  publisher text,
  published_at timestamptz,
  language text,
  -- Tone words the extraction read out of this one content. Tone drift is
  -- measured by comparing these distributions across periods.
  tone text[] not null default '{}'::text[],
  narrative text not null default '',
  images jsonb not null default '[]'::jsonb,
  word_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  extracted_at timestamptz not null default now()
);

create index external_contents_brand_published_idx on external_contents (brand_id, published_at desc);

create table external_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references external_sources (id) on delete cascade,
  brand_id uuid not null references brands (id) on delete cascade,
  chunk_index int not null,
  content text not null,
  token_estimate int not null default 0,
  embedding vector (1536),
  -- Denormalised so retrieval can weight recency without a join.
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index external_chunks_brand_id_idx on external_chunks (brand_id);

create index external_chunks_embedding_idx
  on external_chunks
  using hnsw (embedding vector_cosine_ops);

-- A theme the brand communicates publicly. One row per (kind, label); the
-- counters below are derived from the observations table by trigger.
create table external_memory_entries (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  kind external_memory_kind not null,
  label text not null,
  title text not null,
  content text not null,
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  occurrence_count int not null default 0,
  source_count int not null default 0,
  embedding vector (1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, kind, label)
);

create index external_memory_entries_brand_id_idx on external_memory_entries (brand_id, kind);
create index external_memory_entries_seen_idx on external_memory_entries (brand_id, last_seen_at desc);

create index external_memory_entries_embedding_idx
  on external_memory_entries
  using hnsw (embedding vector_cosine_ops);

-- The fact table. One row per (theme, source), carrying the date the content
-- was published. Everything temporal is computed from here.
create table external_memory_observations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  entry_id uuid not null references external_memory_entries (id) on delete cascade,
  source_id uuid not null references external_sources (id) on delete cascade,
  statement text not null,
  excerpt text not null default '',
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (entry_id, source_id)
);

create index external_observations_brand_idx on external_memory_observations (brand_id, observed_at desc);
create index external_observations_entry_idx on external_memory_observations (entry_id, observed_at);
create index external_observations_source_idx on external_memory_observations (source_id);

-- Cross analysis output: internal memory measured against external reality.
create table brand_insights (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  kind brand_insight_kind not null,
  title text not null,
  summary text not null,
  -- Plain-language "why this exists", built from the scoring components below.
  explanation text not null,
  score real not null default 0,
  components jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  internal_entry_ids uuid[] not null default '{}'::uuid[],
  external_entry_ids uuid[] not null default '{}'::uuid[],
  judged_by text not null default 'HEURISTIC',
  computed_at timestamptz not null default now()
);

create index brand_insights_brand_idx on brand_insights (brand_id, kind, score desc);

create table external_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  status text not null default 'OK',
  notes text not null default '',
  insight_count int not null default 0,
  internal_entry_count int not null default 0,
  external_entry_count int not null default 0,
  external_source_count int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index external_analysis_runs_brand_idx on external_analysis_runs (brand_id, started_at desc);

create trigger external_feeds_set_updated_at
  before update on external_feeds
  for each row execute function set_updated_at();

create trigger external_sources_set_updated_at
  before update on external_sources
  for each row execute function set_updated_at();

create trigger external_memory_entries_set_updated_at
  before update on external_memory_entries
  for each row execute function set_updated_at();

-- Keeps the aggregates on an entry true no matter which code path wrote the
-- observation. first/last seen and the counters are never set by hand.
create or replace function refresh_external_entry_aggregate(p_entry_id uuid) returns void
language sql
as $$
  update external_memory_entries e
  set
    occurrence_count = agg.occurrences,
    source_count = agg.sources,
    first_seen_at = agg.first_seen,
    last_seen_at = agg.last_seen
  from (
    select
      count(o.id)::int as occurrences,
      count(distinct o.source_id)::int as sources,
      min(o.observed_at) as first_seen,
      max(o.observed_at) as last_seen
    from external_memory_observations o
    where o.entry_id = p_entry_id
  ) agg
  where e.id = p_entry_id;
$$;

create or replace function refresh_external_entry_aggregates() returns trigger
language plpgsql
as $$
begin
  -- NEW is unassigned on DELETE and OLD on INSERT, so both are read through
  -- TG_OP rather than coalesced. An UPDATE that moves an observation to another
  -- entry has to refresh both sides.
  if (tg_op = 'DELETE' or tg_op = 'UPDATE') then
    perform refresh_external_entry_aggregate(old.entry_id);
  end if;

  if (tg_op = 'INSERT' or tg_op = 'UPDATE') then
    perform refresh_external_entry_aggregate(new.entry_id);
  end if;

  return null;
end;
$$;

create trigger external_observations_refresh_aggregates
  after insert or update or delete on external_memory_observations
  for each row execute function refresh_external_entry_aggregates();
