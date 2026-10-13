-- 033_short_runs.sql
--
-- Step 15: short runs — digitally printed and CAD cut (no plates, no press).
-- Per-shop rates on corrugated_settings (Admin -> Corrugated, "Short runs"):
--   digital_under_qty     quantities under this are short runs (0 = off).
--                         Short runs only start once cad_cut_per_box_usd > 0.
--   cad_setup_usd         CAD table setup, per order (replaces order setup)
--   cad_cut_per_box_usd   CAD cut, per box (replaces converting)
--   digital_setup_usd     digital print setup / file prep, per order
--   digital_per_sqft_usd  digital print, per sq ft of blank per printed side
-- The run method used for each box is saved in
-- quote_box_selections.pricing_detail.run_method (no column needed); the
-- staff choice for a quote is facts.run_method. Idempotent.

ALTER TABLE public.corrugated_settings
  ADD COLUMN IF NOT EXISTS digital_under_qty    integer        NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS cad_setup_usd        numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cad_cut_per_box_usd  numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS digital_setup_usd    numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS digital_per_sqft_usd numeric(12,4)  NOT NULL DEFAULT 0;
