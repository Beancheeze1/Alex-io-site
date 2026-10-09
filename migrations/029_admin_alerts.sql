-- 029_admin_alerts.sql
--
-- Admin alerts (Step 7): in-app alerts for each shop's staff — new buyer
-- quotes, artwork uploads, buyer changes, spec requests. Read state is per
-- shop (read_at). Idempotent.

CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id          bigserial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  kind        text NOT NULL,          -- new_quote | artwork | buyer_change | spec_request
  quote_no    text,
  title       text NOT NULL,
  detail      text,
  link        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

CREATE INDEX IF NOT EXISTS admin_alerts_tenant_created_idx
  ON public.admin_alerts (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_alerts_tenant_unread_idx
  ON public.admin_alerts (tenant_id)
  WHERE read_at IS NULL;
