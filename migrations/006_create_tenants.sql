-- 006_create_tenants.sql
-- Creates tenants table for subdomain multi-tenant (A2).

create table if not exists public.tenants (
  id bigserial primary key,
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  theme_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenants_slug_idx on public.tenants (slug);