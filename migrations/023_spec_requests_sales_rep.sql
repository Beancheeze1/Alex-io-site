-- 023_spec_requests_sales_rep.sql
--
-- Sales rep attribution for "Send us your specs" requests. A rep link
-- (/q/{sales_slug} -> /t/{tenant}?sales_rep_slug=...) now carries through
-- the specs form. sales_rep_slug is kept as sent; sales_rep_id is the
-- tenant-scoped users.sales_slug match (NULL when nothing matched).
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

ALTER TABLE public.spec_requests
  ADD COLUMN IF NOT EXISTS sales_rep_slug text;

ALTER TABLE public.spec_requests
  ADD COLUMN IF NOT EXISTS sales_rep_id integer REFERENCES public."users"(id) ON DELETE SET NULL;
