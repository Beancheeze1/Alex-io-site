-- 040_shop_emails.sql
--
-- Step 29B: shop-level emails and runs of the hourly reminders
-- (app/lib/reminders.ts). One row per (shop, kind, run_key); a row is
-- inserted before sending, so a second run can't send the same thing twice.
--
--   kind 'reminders_run'  tenant_id 0, run_key = UTC hour (YYYY-MM-DDTHH)
--   kind 'staff_digest'   run_key = the shop's local day (YYYY-MM-DD)
--   status                claimed | sent | failed | skipped
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.shop_emails (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL,
  kind        text NOT NULL,
  run_key     text NOT NULL,
  to_email    text,
  subject     text,
  status      text NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, run_key)
);
