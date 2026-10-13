-- 031_quote_price_lock.sql
--
-- Step 10B: price lock. quotes.price_lock holds the printing (art setup fee
-- + %) and die-cut settings in force when the quote was first priced:
-- { "charges": { printing_upcharge_usd, printing_upcharge_pct,
--                die_cut_trigger_qty, die_cut_upcharge_usd }, "at": ISO time }
-- NULL = not locked yet (set on the next view). Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS price_lock jsonb;
