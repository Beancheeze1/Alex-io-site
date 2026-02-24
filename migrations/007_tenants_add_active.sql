-- 007_tenants_add_active.sql
-- Path A: bring DB schema in line with resolveTenantFromHost() expectations.

alter table public.tenants
  add column if not exists active boolean not null default true;

alter table public.tenants
  add column if not exists theme_json jsonb not null default '{}'::jsonb;

-- optional but safe if you want timestamps available like the plan:
alter table public.tenants
  add column if not exists created_at timestamptz not null default now();

alter table public.tenants
  add column if not exists updated_at timestamptz not null default now();