-- 041_ship_to_freight.sql
--
-- Step 30: ship-to and freight terms on each quote (app/lib/freight.ts).
--   freight_terms         prepaid_add | fob_origin | pickup (null = shop default)
--   ship_to_*             where the order ships (the buyer fills it in on
--                         the quote page; staff can too)
--   freight_account       the buyer's carrier account (FOB origin / collect)
--   freight_override_usd  staff-entered freight (null = worked out from the
--                         shop's weight / zone table)
-- The shop's freight table lives in the pricing settings store.
-- Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS freight_terms         text,
  ADD COLUMN IF NOT EXISTS ship_to_name          text,
  ADD COLUMN IF NOT EXISTS ship_to_company       text,
  ADD COLUMN IF NOT EXISTS ship_to_line1         text,
  ADD COLUMN IF NOT EXISTS ship_to_line2         text,
  ADD COLUMN IF NOT EXISTS ship_to_city          text,
  ADD COLUMN IF NOT EXISTS ship_to_state         text,
  ADD COLUMN IF NOT EXISTS ship_to_zip           text,
  ADD COLUMN IF NOT EXISTS freight_account       text,
  ADD COLUMN IF NOT EXISTS freight_override_usd  numeric(12,2);
