-- 032_quote_facts.sql
--
-- Step 10C: durable quote facts. Quote facts (pack type, print spec, print
-- mode, compare quantities, ...) lived only in Redis with a 14-day expiry, so
-- an old quote could silently lose them and change price model. Every save of
-- a quote's facts now also lands here, and a Redis miss is filled from here.
-- Keyed by quote number (email-thread memory stays Redis-only). Idempotent.

CREATE TABLE IF NOT EXISTS public.quote_facts (
  quote_no   text PRIMARY KEY,
  facts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
