-- 048_cad_cut_hourly.sql
--
-- Step 39A: short runs are CAD cut by time, not a flat $ per box.
-- Per-shop rates on corrugated_settings (Admin -> Corrugated, "Short runs"):
--   cad_cut_per_hr_usd    CAD table rate, $ per hour (replaces cad_cut_per_box_usd)
--   cad_speed_in_per_min  CAD table speed, inches of cut + score per minute
-- CAD cut cost = qty x (cut + score path per box, in) / speed (in/min) / 60 x $/hr.
-- Short runs start once the cutoff, the rate and the speed are all above 0.
-- cad_cut_per_box_usd is left in place (no longer read). Idempotent.

ALTER TABLE public.corrugated_settings
  ADD COLUMN IF NOT EXISTS cad_cut_per_hr_usd   numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cad_speed_in_per_min numeric(12,4)  NOT NULL DEFAULT 0;
