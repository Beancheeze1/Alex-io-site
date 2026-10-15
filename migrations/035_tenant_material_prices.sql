-- 035_tenant_material_prices.sql
--
-- Step 20: each shop sets its own material prices.
-- public.materials stays the shared catalog (names, families, densities and
-- the catalog prices). A row here overrides the catalog for one shop; any
-- NULL field falls back to the catalog value. No row = the shop uses the
-- catalog for that material (lib/material-prices.ts).
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.tenant_material_prices (
  tenant_id       integer        NOT NULL,
  material_id     integer        NOT NULL,
  price_per_cuin  numeric(12,6),
  min_charge_usd  numeric(12,2),
  kerf_waste_pct  numeric(7,3),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, material_id)
);

CREATE INDEX IF NOT EXISTS tenant_material_prices_material_idx
  ON public.tenant_material_prices (material_id);
