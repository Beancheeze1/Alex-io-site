-- 027_quote_box_selections_print.sql
--
-- Corrugated Step 3B: per-color printing. What each box row was priced with:
--   print_colors  jsonb array of 'spot' | 'flood' (one per color); NULL = the
--                 quote isn't on the per-color model (legacy art-setup fee + %)
--   print_sides   1 | 2
--   print_usd     print run + print setup (marked up) added to a stock /
--                 nearest-stock box's price, for its qty. NULL for engine-priced
--                 custom RSC, where print is inside the engine unit price.
--   plates_usd    one-time plates (marked up) for this box; shown as one line
--
-- Additive and idempotent.

ALTER TABLE public.quote_box_selections
  ADD COLUMN IF NOT EXISTS print_colors  jsonb,
  ADD COLUMN IF NOT EXISTS print_sides   smallint,
  ADD COLUMN IF NOT EXISTS print_usd     numeric,
  ADD COLUMN IF NOT EXISTS plates_usd    numeric;
