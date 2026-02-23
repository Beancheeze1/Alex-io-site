-- 002_create_tenants.sql
create table if not exists public.tenants (
  id serial primary key,
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional: keep updated_at current without triggers (Path A: skip triggers for now).