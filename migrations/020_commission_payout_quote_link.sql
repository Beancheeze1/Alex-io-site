-- 020_commission_payout_quote_link.sql
--
-- Fixes the commission close orphaning bug: closing a month used to filter
-- qualifying (locked/RFM) quotes by "created_at falls inside the selected
-- calendar month", so a quote from a month nobody explicitly closed could
-- be permanently orphaned -- never captured by any closed period, even
-- though live totals kept counting it.
--
-- This adds quotes.commission_payout_id, mirroring expenses.expense_payout_id
-- (see migrations/019_expense_payouts.sql): a close now sweeps every locked
-- quote not yet linked to ANY prior commission_payouts row for that rep,
-- full stop, never filtered by date. The link column is also what prevents
-- a quote from being double-counted across periods.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS). Backfills
-- nothing -- existing commission_payouts rows and the quotes counted in
-- them are untouched; this only changes how FUTURE closes select rows.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS commission_payout_id integer DEFAULT NULL;

CREATE INDEX IF NOT EXISTS quotes_commission_payout_idx
  ON public.quotes (tenant_id, sales_rep_id, commission_payout_id);
