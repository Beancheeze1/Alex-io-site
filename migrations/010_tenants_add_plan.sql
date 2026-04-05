-- 010_tenants_add_plan.sql
--
-- Adds plan tier column to the tenants table.
-- Drives feature gating across the platform:
--   starter  → $599/mo  · 2 seats   · PDF only, no CAD exports
--   pro      → $1199/mo · 10 seats  · CAD/DXF/STEP, HubSpot, commissions
--   shop     → $1999/mo · unlimited · Multi-location, white-label, API
--
-- Default is 'pro' so ALL existing tenants keep their current full access.
-- Safe to run multiple times (idempotent via IF NOT EXISTS / DO NOTHING).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'pro';

-- Constrain to valid values (belt + suspenders alongside app-level checks)
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_plan_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('starter', 'pro', 'shop'));

COMMENT ON COLUMN public.tenants.plan IS
  'Subscription tier: starter | pro | shop. '
  'Controls seat limits, CAD exports, HubSpot sync, and multi-tenancy. '
  'Default pro preserves all existing tenant capabilities.';
