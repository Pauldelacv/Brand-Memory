-- Vector search entry points.
-- These run SECURITY INVOKER (the default) so row level security still applies,
-- and they additionally assert ownership so a service-role caller cannot
-- accidentally read across brands.

create or replace function match_document_chunks(
  p_brand_id uuid,
  p_query_embedding vector (1536),
  p_match_count int default 8,
  p_min_similarity float default 0.0
)
returns table (
  id uuid,
  source_id uuid,
  content text,
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
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from document_chunks c
  where c.brand_id = p_brand_id
    and c.embedding is not null
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;

create or replace function match_memory_entries(
  p_brand_id uuid,
  p_query_embedding vector (1536),
  p_match_count int default 6,
  p_min_similarity float default 0.0
)
returns table (
  id uuid,
  category memory_category,
  title text,
  content text,
  source_references jsonb,
  confidence real,
  origin memory_origin,
  updated_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    m.id,
    m.category,
    m.title,
    m.content,
    m.source_references,
    m.confidence,
    m.origin,
    m.updated_at,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from brand_memory_entries m
  where m.brand_id = p_brand_id
    and m.embedding is not null
    and 1 - (m.embedding <=> p_query_embedding) >= p_min_similarity
  order by m.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;
