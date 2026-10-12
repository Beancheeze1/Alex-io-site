-- 030_box_selection_qty_breaks.sql
--
-- Step 9A: per-size compare quantities for multi-size boxes-only quotes.
-- qty_breaks = the row's ordered qty plus up to 3 compare quantities,
-- ascending (jsonb array of integers), or NULL. Idempotent.

ALTER TABLE public.quote_box_selections
  ADD COLUMN IF NOT EXISTS qty_breaks jsonb;
