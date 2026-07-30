-- 017_boxes_add_tenant_id.sql
--
-- Adds tenant_id to public.boxes so tenants can add their own custom
-- box/mailer sizes without affecting other tenants' catalogs.
--
-- NULL tenant_id = global/shared catalog entry, visible to every tenant
-- (all 168 existing rows -- the shared Box Partners stock catalog -- keep
-- this default and are completely unaffected by this migration).
-- Non-null tenant_id = a tenant-specific custom size, visible only to that
-- tenant (in addition to the global rows).
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

ALTER TABLE public."boxes"
  ADD COLUMN IF NOT EXISTS tenant_id integer REFERENCES public.tenants(id);

CREATE INDEX IF NOT EXISTS idx_boxes_tenant_id
  ON public."boxes" (tenant_id);

COMMENT ON COLUMN public."boxes".tenant_id IS
  'NULL = global/shared catalog entry visible to all tenants (the default '
  'Box Partners stock catalog). Non-null = a tenant-specific custom box/mailer '
  'size, visible only to that tenant.';
