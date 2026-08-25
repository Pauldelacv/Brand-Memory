-- Brand Memory — initial schema
-- Postgres + pgvector. Every row is scoped to a brand, every brand to a user.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Embeddings are stored at a fixed dimension so pgvector can index them.
-- Every AIProvider implementation MUST return vectors of this size.
-- See src/lib/ai/embeddings.ts (EMBEDDING_DIMENSIONS).

create type source_status as enum ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

create type memory_category as enum (
  'IDENTITY',
  'POSITIONING',
  'AUDIENCE',
  'PERSONALITY',
  'VOICE',
  'VISUAL_LANGUAGE',
  'VALUES',
  'PRODUCT',
  'CREATIVE_HISTORY'
);

-- AI extraction is a suggestion; a user edit outranks it during conflict resolution.
create type memory_origin as enum ('AI_EXTRACTED', 'USER_EDITED');

create table brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  industry text not null default '',
  website text,
  audience text,
  positioning text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index brands_owner_id_idx on brands (owner_id, created_at desc);

create table brand_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  filename text not null,
  mime_type text not null,
  byte_size bigint not null default 0,
  storage_path text not null,
  status source_status not null default 'UPLOADED',
  error text,
  -- Conflict resolution inputs: higher priority and newer source_date win.
  priority int not null default 0,
  source_date date,
  authoritative boolean not null default false,
  chunk_count int not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index brand_sources_brand_id_idx on brand_sources (brand_id, created_at desc);

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references brand_sources (id) on delete cascade,
  -- Denormalised so retrieval can filter by brand without a join.
  brand_id uuid not null references brands (id) on delete cascade,
  chunk_index int not null,
  content text not null,
  token_estimate int not null default 0,
  embedding vector (1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index document_chunks_brand_id_idx on document_chunks (brand_id);

create index document_chunks_embedding_idx
  on document_chunks
  using hnsw (embedding vector_cosine_ops);

create table brand_memory_entries (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  category memory_category not null,
  title text not null,
  content text not null,
  -- [{ sourceId, sourceName, excerpt }]
  source_references jsonb not null default '[]'::jsonb,
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  origin memory_origin not null default 'AI_EXTRACTED',
  embedding vector (1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index brand_memory_entries_brand_id_idx on brand_memory_entries (brand_id, category);

create index brand_memory_entries_embedding_idx
  on brand_memory_entries
  using hnsw (embedding vector_cosine_ops);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  title text not null default 'Untitled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_brand_id_idx on conversations (brand_id, updated_at desc);

create type message_role as enum ('user', 'assistant');

create type generation_mode as enum ('ASK', 'CREATE', 'EXPLORE', 'COMPARE');

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  brand_id uuid not null references brands (id) on delete cascade,
  role message_role not null,
  content text not null,
  mode generation_mode not null default 'ASK',
  -- Retrieval trace kept with the message so attribution survives a reload.
  retrieval jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_idx on messages (conversation_id, created_at);

create or replace function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger brands_set_updated_at
  before update on brands
  for each row execute function set_updated_at();

create trigger brand_memory_entries_set_updated_at
  before update on brand_memory_entries
  for each row execute function set_updated_at();

create trigger conversations_set_updated_at
  before update on conversations
  for each row execute function set_updated_at();
