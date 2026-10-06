-- 026_quote_box_selections_board_grade.sql
--
-- Corrugated Step 3A: custom RSC selections priced by the corrugated engine.
--   board_grade_id / board_grade_name  grade used to price the box (custom RSC)
--   pricing_source   'corrugated_engine' | 'nearest_stock' | 'none'
--                    (NULL for stock rows and rows written before 026)
--   needs_review     true when a custom RSC fell back to nearest-stock pricing
--   pricing_note     staff-only explanation (why it fell back, rate warnings)
--   pricing_detail   engine snapshot (blank size, cost lines) for audit
--
-- Additive and idempotent. Existing rows keep needs_review = false.

ALTER TABLE public.quote_box_selections
  ADD COLUMN IF NOT EXISTS board_grade_id    bigint,
  ADD COLUMN IF NOT EXISTS board_grade_name  text,
  ADD COLUMN IF NOT EXISTS pricing_source    text,
  ADD COLUMN IF NOT EXISTS needs_review      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_note      text,
  ADD COLUMN IF NOT EXISTS pricing_detail    jsonb;
