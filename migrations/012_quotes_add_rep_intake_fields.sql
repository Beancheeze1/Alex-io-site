-- Adds durable columns for fields captured by the new rep quote-intake
-- form (RepStartQuoteModal), so PO numbers, rush flags, quantity, qty/price
-- breaks, and internal notes are stored on the quote itself rather than in
-- the ephemeral (14-day TTL) facts/Redis store.

ALTER TABLE public."quotes"
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS is_rush boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qty numeric,
  ADD COLUMN IF NOT EXISTS qty_breaks jsonb,
  ADD COLUMN IF NOT EXISTS internal_notes text;
