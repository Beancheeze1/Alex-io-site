-- 034_shipping_per_shop.sql
--
-- Step 19: the rough shipping estimate is set per shop.
-- public.shipping_settings gets tenant_id; at most one row per shop.
-- The existing row(s) keep tenant_id NULL and become the platform default a
-- shop uses until it saves its own (lib/shipping-settings.ts).
-- The table was created by hand originally, so create it if it's missing.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.shipping_settings (
  id                serial         PRIMARY KEY,
  rough_ship_pct    numeric(6,3)   NOT NULL DEFAULT 2,
  shipping_cap_usd  numeric(12,2)
);

ALTER TABLE public.shipping_settings
  ADD COLUMN IF NOT EXISTS tenant_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS shipping_settings_one_per_tenant
  ON public.shipping_settings (tenant_id)
  WHERE tenant_id IS NOT NULL;
