-- 009_quotes_add_is_demo.sql
--
-- Adds is_demo flag to the quotes table.
-- Demo quotes are created by the public landing page demo flow.
-- They are real rows in the DB and go through the full quoting pipeline,
-- but are visually watermarked and can be bulk-deleted via the admin cleanup tool.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

ALTER TABLE public."quotes"
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Optional index so the cleanup tool can quickly find demo quotes
CREATE INDEX IF NOT EXISTS idx_quotes_is_demo
  ON public."quotes" (is_demo)
  WHERE is_demo = true;

COMMENT ON COLUMN public."quotes".is_demo IS
  'True for quotes created via the public landing page demo flow. '
  'Safe to bulk-delete via the admin cleanup tool.';
