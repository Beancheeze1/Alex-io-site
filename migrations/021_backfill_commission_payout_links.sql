-- 021_backfill_commission_payout_links.sql
--
-- Companion to 020_commission_payout_quote_link.sql. That migration adds
-- quotes.commission_payout_id but leaves it NULL on every existing row --
-- correct for a brand-new install, but NOT safe on a database that already
-- has commission_payouts history built under the OLD date-range snapshot
-- logic (no link column ever existed, so nothing recorded which quotes a
-- historical payout actually summed).
--
-- Without this backfill, a locked quote that was already counted in an
-- existing (possibly PAID) commission_payouts row would look "outstanding"
-- to the new link-column sweep and get swept into the NEXT close too --
-- double-counting it.
--
-- This reconstructs the links using the exact same rule the OLD close used
-- (same tenant, same rep, quote's created_at falls inside the payout's
-- period month) and applies it ONLY to quotes that don't already have a
-- link. A quote whose created_at month was never actually closed correctly
-- finds no match here and stays unlinked/outstanding -- exactly right: it
-- genuinely was never captured, so it should be picked up by whoever closes
-- a period for that rep next, the same as any other previously-orphaned
-- record.
--
-- Idempotent: safe to run multiple times (the WHERE clause only touches
-- unlinked rows, so a second run is a no-op). Touches ONLY
-- quotes.commission_payout_id -- never writes to commission_payouts itself,
-- so no historical total, rate, or paid_at is altered.

UPDATE public.quotes q
SET commission_payout_id = cp.id
FROM public.commission_payouts cp
WHERE q.tenant_id = cp.tenant_id
  AND q.sales_rep_id = cp.user_id
  AND q.locked = true
  AND q.commission_payout_id IS NULL
  AND q.created_at >= (cp.period || '-01')::date
  AND q.created_at < ((cp.period || '-01')::date + interval '1 month');
