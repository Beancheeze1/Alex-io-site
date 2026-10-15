-- 042_freight_lock.sql
--
-- Step 30B: the freight a quote was accepted / confirmed with.
--   freight_lock  { key, result } (app/lib/freight.ts). While the ship-to,
--                 terms, staff override and the quote's other charges are
--                 the same as when it was saved, the quote keeps this freight,
--                 so a later change to the shop's freight table (or turning
--                 freight off) doesn't change accepted quotes. "Reprice at
--                 today's rates" clears it.
-- Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS freight_lock jsonb;
