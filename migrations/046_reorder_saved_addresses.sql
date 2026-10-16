-- 046_reorder_saved_addresses.sql
--
-- Step 34B: reorders and saved ship-to addresses.
--   quotes.reorder_of          the quote a reorder was copied from
--   buyer_hidden_addresses     ship-to addresses a buyer removed from their
--                              "Saved addresses" list (per shop + email);
--                              saved addresses themselves come from the
--                              buyer's past quotes, so nothing else is stored
-- Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS reorder_of text;

CREATE TABLE IF NOT EXISTS public.buyer_hidden_addresses (
  tenant_id    bigint NOT NULL,
  email        text NOT NULL,
  address_key  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, email, address_key)
);
