-- 053_assembly_methods.sql
--
-- Step 49: each shop's assembly methods for displays and multi-part jobs
-- (Admin -> Pricing -> Corrugated boxes -> Displays and multi-part jobs).
-- A list of { id, name, minutes, materials_usd, is_default }: minutes of
-- labor and materials $ per piece. Each display part can pick one (stored on
-- the part's quote_box_selections.dieline as asm: { method, minutes }).
-- Empty list = displays price exactly as before. Idempotent.

ALTER TABLE public.corrugated_settings
  ADD COLUMN IF NOT EXISTS asm_methods jsonb NOT NULL DEFAULT '[]'::jsonb;
