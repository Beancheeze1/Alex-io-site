-- 052_tenant_assets.sql
--
-- Step 46: images a shop uploads for its Quotes & ordering page (Shop
-- settings → Shop page): its logo and banner photo. Stored as bytea (same
-- approach as quote_attachments and spec_requests) and served publicly by
-- /api/public/shop-asset/<id>. A shop keeps only its current logo and banner:
-- an upload removes that shop's older file of the same kind.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.tenant_assets (
  id            bigserial   PRIMARY KEY,
  tenant_id     integer     NOT NULL,
  kind          text        NOT NULL,
  content_type  text        NOT NULL,
  bytes         integer     NOT NULL,
  sha256        text        NOT NULL,
  data          bytea       NOT NULL,
  created_by    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_assets DROP CONSTRAINT IF EXISTS tenant_assets_kind_check;
ALTER TABLE public.tenant_assets ADD CONSTRAINT tenant_assets_kind_check
  CHECK (kind IN ('logo', 'banner'));

CREATE INDEX IF NOT EXISTS tenant_assets_tenant_kind_idx
  ON public.tenant_assets (tenant_id, kind, created_at DESC);
