-- 016_quotes_add_quote_source.sql
--
-- Adds quote_source: which CHANNEL a quote was created through (reporting
-- only), distinct from sales_rep_id (WHO gets commission credit). A quote
-- can be embed_website-sourced with no rep, or direct with a rep attached,
-- etc. -- these are independent facts and must not gate one another.
--
-- Values:
--   direct        -- Alex-IO-hosted /start-quote, including /q/{slug} and
--                    /t/{tenant} sales-rep links (the existing pre-embed flow).
--   embed_website -- embedded chat/quote-form widget on a tenant's own
--                    external website (/embed/chat, /embed/quote-form).
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

ALTER TABLE public."quotes"
  ADD COLUMN IF NOT EXISTS quote_source text NOT NULL DEFAULT 'direct';

CREATE INDEX IF NOT EXISTS idx_quotes_quote_source
  ON public."quotes" (quote_source);

COMMENT ON COLUMN public."quotes".quote_source IS
  'Channel/origin the quote was created through: direct (Alex-IO-hosted /start-quote, '
  'including /q/{slug} and /t/{tenant} sales links) or embed_website (embedded chat/form '
  'widget on a tenant''s own external website). Purely reporting -- does not affect '
  'sales_rep_id attribution.';
