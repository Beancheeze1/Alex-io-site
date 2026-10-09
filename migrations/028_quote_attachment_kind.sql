-- 028_quote_attachment_kind.sql
--
-- Corrugated Step 6: print artwork uploads are stored in quote_attachments
-- and marked kind = 'artwork'. Existing rows (sketches, PDFs, normalized
-- CAD, forge JSON) keep kind NULL. Idempotent.

ALTER TABLE public.quote_attachments
  ADD COLUMN IF NOT EXISTS kind text;

CREATE INDEX IF NOT EXISTS quote_attachments_quote_kind_idx
  ON public.quote_attachments (quote_id, kind);
