-- 001_schema_migrations.sql
create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);