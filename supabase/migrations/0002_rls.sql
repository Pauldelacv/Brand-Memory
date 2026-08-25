-- Multi-tenancy. A user must never reach another user's brand by changing an id.
-- Every policy resolves back to brands.owner_id = auth.uid().

alter table brands enable row level security;
alter table brand_sources enable row level security;
alter table document_chunks enable row level security;
alter table brand_memory_entries enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

create or replace function owns_brand(p_brand_id uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from brands
    where brands.id = p_brand_id
      and brands.owner_id = auth.uid()
  );
$$;

create policy brands_select on brands
  for select using (owner_id = auth.uid());
create policy brands_insert on brands
  for insert with check (owner_id = auth.uid());
create policy brands_update on brands
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy brands_delete on brands
  for delete using (owner_id = auth.uid());

create policy brand_sources_all on brand_sources
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy document_chunks_all on document_chunks
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy brand_memory_entries_all on brand_memory_entries
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy conversations_all on conversations
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

create policy messages_all on messages
  for all using (owns_brand(brand_id)) with check (owns_brand(brand_id));

-- Storage: one bucket, one folder per brand. Path convention: <brand_id>/<source_id>-<filename>
insert into storage.buckets (id, name, public)
values ('brand-sources', 'brand-sources', false)
on conflict (id) do nothing;

create policy brand_sources_storage_all on storage.objects
  for all
  using (
    bucket_id = 'brand-sources'
    and owns_brand(nullif(split_part(name, '/', 1), '')::uuid)
  )
  with check (
    bucket_id = 'brand-sources'
    and owns_brand(nullif(split_part(name, '/', 1), '')::uuid)
  );
