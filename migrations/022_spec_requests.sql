-- 022_spec_requests.sql
--
-- "Send us your specs" requests from tenant Quotes & ordering pages
-- (/t/[tenant]/specs). Each request belongs to one tenant and has 0-3 files
-- stored as bytea (same approach as quote_attachments).
--
-- notify_status / confirm_status record every email outcome so nothing fails
-- silently: the admin inbox shows a failed or missing notification.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.spec_requests (
  id              bigserial PRIMARY KEY,
  tenant_id       integer     NOT NULL,
  name            text        NOT NULL,
  email           text        NOT NULL,
  company         text,
  phone           text,
  notes           text,
  status          text        NOT NULL DEFAULT 'new',
  notify_status   text        NOT NULL DEFAULT 'pending',
  notify_error    text,
  confirm_status  text        NOT NULL DEFAULT 'pending',
  confirm_error   text,
  source_ip       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spec_requests DROP CONSTRAINT IF EXISTS spec_requests_status_check;
ALTER TABLE public.spec_requests ADD CONSTRAINT spec_requests_status_check
  CHECK (status IN ('new', 'in_progress', 'quoted', 'closed'));

ALTER TABLE public.spec_requests DROP CONSTRAINT IF EXISTS spec_requests_notify_status_check;
ALTER TABLE public.spec_requests ADD CONSTRAINT spec_requests_notify_status_check
  CHECK (notify_status IN ('pending', 'sent', 'failed', 'no_recipient'));

ALTER TABLE public.spec_requests DROP CONSTRAINT IF EXISTS spec_requests_confirm_status_check;
ALTER TABLE public.spec_requests ADD CONSTRAINT spec_requests_confirm_status_check
  CHECK (confirm_status IN ('pending', 'sent', 'failed'));

CREATE INDEX IF NOT EXISTS spec_requests_tenant_created_idx
  ON public.spec_requests (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.spec_request_files (
  id               bigserial PRIMARY KEY,
  spec_request_id  bigint      NOT NULL REFERENCES public.spec_requests(id) ON DELETE CASCADE,
  filename         text        NOT NULL,
  content_type     text,
  size_bytes       integer     NOT NULL,
  data             bytea       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spec_request_files_request_idx
  ON public.spec_request_files (spec_request_id);
