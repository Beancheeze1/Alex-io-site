-- 003_add_users_tenant_id.sql

-- 1) Add nullable tenant_id
alter table public.users
  add column if not exists tenant_id integer;

-- 2) Ensure a default tenant exists (deterministic slug)
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
update public.users
set tenant_id = (select id from tid)
where tenant_id is null;

-- 3) FK (nullable allowed)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_tenant_id_fkey'
  ) then
    alter table public.users
      add constraint users_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id);
  end if;
end $$;