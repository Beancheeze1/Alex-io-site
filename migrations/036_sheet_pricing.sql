-- 036_sheet_pricing.sql
--
-- Step 26: corrugated board priced as sheets bought from a corrugator.
-- Per-shop settings on corrugated_settings (Admin -> Corrugated, "Board bought
-- as sheets"):
--   board_method         'blank' = blank sq ft x (1 + waste %) x $/MSF (as before)
--                        'sheet' = sheets bought x sheet sq ft x $/MSF
--   sheet_trim_in        corrugator trim, added to sheet length and width
--   sheet_round_to_in    sheet sizes round up to this (0 = exact)
--   sheet_max_length_in  largest sheet, along the blank's length (0 = one up)
--   sheet_max_width_in   largest sheet, along the blank's width (0 = one up)
--   sheet_max_up         most blanks per sheet (1 = one up)
--   sheet_min_msf        corrugator minimum MSF per order (0 = none)
-- Every shop starts on 'blank', so no price changes until a shop switches.
-- Idempotent.

ALTER TABLE public.corrugated_settings
  ADD COLUMN IF NOT EXISTS board_method        text           NOT NULL DEFAULT 'blank',
  ADD COLUMN IF NOT EXISTS sheet_trim_in       numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sheet_round_to_in   numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sheet_max_length_in numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sheet_max_width_in  numeric(12,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sheet_max_up        integer        NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS sheet_min_msf       numeric(12,4)  NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corrugated_settings_board_method_check'
  ) THEN
    ALTER TABLE public.corrugated_settings
      ADD CONSTRAINT corrugated_settings_board_method_check
      CHECK (board_method IN ('blank', 'sheet'));
  END IF;
END $$;
