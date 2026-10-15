-- 039_quote_emails.sql
--
-- Step 29A: a log of every email Alex-IO sends (or skips) for a quote, so the
-- shop can see what the buyer was told and when (admin quote page, Approval).
-- Written by app/lib/quote-mail.ts. Idempotent.
--
--   kind       quote | accepted | confirmed | reapprove | released
--   status     sent | failed | skipped
--   detail     why it was skipped / failed (e.g. "no buyer email", a Graph error)
--   total      the quote total the email named

CREATE TABLE IF NOT EXISTS public.quote_emails (
  id          bigserial PRIMARY KEY,
  quote_id    bigint NOT NULL,
  tenant_id   bigint,
  kind        text NOT NULL,
  to_email    text,
  subject     text,
  status      text NOT NULL,
  detail      text,
  total       numeric(14,2),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_emails_quote_idx
  ON public.quote_emails (quote_id, created_at DESC);
