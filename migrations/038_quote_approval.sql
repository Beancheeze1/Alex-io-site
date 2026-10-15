-- 038_quote_approval.sql
--
-- Step 28: estimate -> buyer accepted -> shop confirmed, expiry and lead time.
-- Rules: app/lib/quote-approval-core.ts. Each acceptance / confirmation keeps
-- the quote total it was given for, so a later price change is seen by
-- comparing totals (the buyer then re-approves).
--
--   accepted_at / accepted_name / accepted_po / accepted_total
--                     the buyer's acceptance (or staff recording it for them:
--                     accepted_by_staff)
--   confirmed_at / confirmed_by / confirmed_total
--                     the shop's confirmation
--   priced_at         last "Reprice at today's rates" (restarts expiry)
--   expires_at        staff override of the expiry date (null = shop default)
--   lead_time_text    staff override of the lead time (null = shop default)
--
-- The shop defaults ("quote valid" days, lead time) live in the pricing
-- settings store. Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS accepted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_name     text,
  ADD COLUMN IF NOT EXISTS accepted_po       text,
  ADD COLUMN IF NOT EXISTS accepted_total    numeric(14,2),
  ADD COLUMN IF NOT EXISTS accepted_by_staff boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by      text,
  ADD COLUMN IF NOT EXISTS confirmed_total   numeric(14,2),
  ADD COLUMN IF NOT EXISTS priced_at         timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at        timestamptz,
  ADD COLUMN IF NOT EXISTS lead_time_text    text;
