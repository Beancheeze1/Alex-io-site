-- 049_box_dieline.sql
--
-- Step 39C: a box line priced from an uploaded die line (custom_style
-- 'dieline') keeps what was measured from the file: blank size, cut /
-- crease / perf inches, the line roles staff confirmed, the units, the
-- file name and the quote_attachments row holding the original file.
-- Idempotent.

ALTER TABLE public.quote_box_selections
  ADD COLUMN IF NOT EXISTS dieline jsonb;
