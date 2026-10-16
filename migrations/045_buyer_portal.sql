-- 045_buyer_portal.sql
--
-- Step 34A: the buyer portal (/t/[tenant]/orders) and "shipped".
--   quotes.shipped_*       set by staff on a released quote: when, carrier,
--                          tracking number, a note, and who marked it
--   buyer_login_links      one-time sign-in links emailed to buyers (only a
--                          SHA-256 of the token is stored); 30 minutes, used once
-- Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS shipped_at       timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_carrier  text,
  ADD COLUMN IF NOT EXISTS shipped_tracking text,
  ADD COLUMN IF NOT EXISTS shipped_note     text,
  ADD COLUMN IF NOT EXISTS shipped_by       text;

CREATE TABLE IF NOT EXISTS public.buyer_login_links (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL,
  email       text NOT NULL,
  token_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  ip          text
);

CREATE UNIQUE INDEX IF NOT EXISTS buyer_login_links_token_idx
  ON public.buyer_login_links (token_hash);

CREATE INDEX IF NOT EXISTS buyer_login_links_email_idx
  ON public.buyer_login_links (tenant_id, lower(email), created_at DESC);
