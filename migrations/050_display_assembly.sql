-- 050_display_assembly.sql
--
-- Step 39D: displays and other multi-part jobs. Each shop sets how it costs
-- assembly and packing (Admin -> Pricing -> Corrugated boxes, "Displays and
-- multi-part jobs"). Every field is optional; 0 = not used. Per display:
--   asm_per_display_usd    $ per display (flat)
--   asm_per_part_usd       $ per part in the display
--   labor_per_hr_usd       labor rate, $ per hour
--   labor_min_per_display  labor minutes per display (base)
--   labor_min_per_part     labor minutes per part
--   kit_per_display_usd    kitting / packing, $ per display
-- Idempotent.

ALTER TABLE public.corrugated_settings
  ADD COLUMN IF NOT EXISTS asm_per_display_usd   numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asm_per_part_usd      numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_per_hr_usd      numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_min_per_display numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_min_per_part    numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kit_per_display_usd   numeric(12,4) NOT NULL DEFAULT 0;
