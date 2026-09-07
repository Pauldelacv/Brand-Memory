-- Multi-tenancy for the external half. Same rule as 0002: every policy resolves
-- back to brands.owner_id = auth.uid(). External content is fetched from the
-- public web, but who fetched it, and everything derived from it, is not public.

alter table external_feeds enable row level security;
alter table external_sources enable row level security;
alter table external_contents enable row level security;
alter table external_chunks enable row level security;
alter table external_memory_entries enable row level security;
alter table external_memory_observations enable row level security;
alter table brand_insights enable row level security;
alter table external_analysis_runs enable row level security;

create policy external_feeds_all on external_feeds
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy external_sources_all on external_sources
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy external_contents_all on external_contents
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy external_chunks_all on external_chunks
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy external_memory_entries_all on external_memory_entries
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy external_memory_observations_all on external_memory_observations
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy brand_insights_all on brand_insights
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy external_analysis_runs_all on external_analysis_runs
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));
