-- 004_users_tenant_id_not_null.sql
--
-- Enforce tenant_id required for all users.
-- Defensive: ensure default tenant exists, backfill any nulls, then SET NOT NULL.

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

alter table public.users
  alter column tenant_id set not null;