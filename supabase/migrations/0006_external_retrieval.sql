-- Vector search over the external half, mirroring 0003.
-- SECURITY INVOKER (the default) so row level security still applies, and the
-- brand filter is explicit so a service-role caller cannot read across brands.

create or replace function match_external_chunks(
  p_brand_id uuid,
  p_query_embedding vector (1536),
  p_match_count int default 8,
  p_min_similarity float default 0.0
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  published_at timestamptz,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.source_id,
    c.content,
    c.published_at,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from external_chunks c
  join external_sources s on s.id = c.source_id
  where c.brand_id = p_brand_id
    and c.embedding is not null
    -- A source recognised as a duplicate stays queryable in its own right but
    -- never re-enters retrieval; otherwise one press release covered by nine
    -- outlets would crowd out everything else.
    and s.status = 'READY'
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;

create or replace function match_external_memory_entries(
  p_brand_id uuid,
  p_query_embedding vector (1536),
  p_match_count int default 6,
  p_min_similarity float default 0.0
)
returns table (
  id uuid,
  kind external_memory_kind,
  label text,
  title text,
  content text,
  confidence real,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  occurrence_count int,
  source_count int,
  updated_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    m.id,
    m.kind,
    m.label,
    m.title,
    m.content,
    m.confidence,
    m.first_seen_at,
    m.last_seen_at,
    m.occurrence_count,
    m.source_count,
    m.updated_at,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from external_memory_entries m
  where m.brand_id = p_brand_id
    and m.embedding is not null
    and 1 - (m.embedding <=> p_query_embedding) >= p_min_similarity
  order by m.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;
