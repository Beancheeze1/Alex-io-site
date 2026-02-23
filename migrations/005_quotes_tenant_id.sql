-- 005_quotes_tenant_id.sql
--
-- Add tenant_id to quotes, backfill to default tenant, then enforce required + FK.

-- 1) Add column (nullable first)
alter table public.quotes
  add column if not exists tenant_id integer;

-- 2) Ensure default tenant exists + backfill any null quotes.tenant_id
with ins as (
  insert into public.tenants (slug, name)
  values ('default', 'Default Tenant')
  on conflict (slug) do update set name = excluded.name
  returning id
),
tid as (
  select id from ins
  union all
  select id from public.tenants where slug = 'default' limit 1
)
update public.quotes
set tenant_id = (select id from tid)
where tenant_id is null;

-- 3) FK
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_tenant_id_fkey'
  ) then
    alter table public.quotes
      add constraint quotes_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id);
  end if;
end $$;

-- 4) Required
alter table public.quotes
  alter column tenant_id set not null;

-- 5) Helpful index for scoping
create index if not exists idx_quotes_tenant_id_created_at
  on public.quotes (tenant_id, created_at desc);