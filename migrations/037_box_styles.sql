-- 037_box_styles.sql
--
-- Step 27: more corrugated styles (HSC, FOL, die-cut mailer, die-cut tray,
-- pads, partition sets). See lib/box-styles.ts.
--
-- corrugated_settings (Admin -> Corrugated, "Other box styles"):
--   diecut_per_m     die-cut converting, $ per 1,000 (mailers, trays)
--   die_base_usd     cutting die, base $ per die
--   die_per_in_usd   cutting die, $ per inch of rule
--   pad_per_m        pad cutting, $ per 1,000 pads
--   partition_per_m  partition slotting + assembly, $ per 1,000 sets
--
-- quote_box_selections:
--   tooling_usd          one-time cutting die for the row (marked up), shown
--                        as its own line like plates_usd
--   custom_cells_across  partition sets: cells across (along the length)
--   custom_cells_down    partition sets: cells down (along the width)
--
-- custom_style stays free text; the app accepts rsc, hsc, fol, mailer, tray,
-- pad and partition. Pads store custom_height_in = 0. Idempotent.

ALTER TABLE public.corrugated_settings
  ADD COLUMN IF NOT EXISTS diecut_per_m    numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS die_base_usd    numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS die_per_in_usd  numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pad_per_m       numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partition_per_m numeric(12,4) NOT NULL DEFAULT 0;

ALTER TABLE public.quote_box_selections
  ADD COLUMN IF NOT EXISTS tooling_usd         numeric(12,2),
  ADD COLUMN IF NOT EXISTS custom_cells_across integer,
  ADD COLUMN IF NOT EXISTS custom_cells_down   integer;
