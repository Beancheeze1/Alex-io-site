-- 054_quote_project_name.sql
--
-- Step 50: a project name on each quote ("Kroger endcap", "Spring promo
-- shippers"), so staff and buyers can find a quote without its number.
-- Optional, up to 80 characters (lib/project-name.ts). Shown under the quote
-- number on the quotes list (and searched there), on the admin and buyer
-- quote pages. Idempotent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS project_name text;

CREATE INDEX IF NOT EXISTS quotes_tenant_project_name_idx
  ON public.quotes (tenant_id, lower(project_name))
  WHERE project_name IS NOT NULL;
