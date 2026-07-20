-- Adds a real customers table, and links quotes to it via customer_id —
-- replacing "find this customer's other quotes" via fragile text-matching
-- (customer_name/email substring search on the quotes list) with a real,
-- reliable relationship.
--
-- Scope, deliberately conservative: this migration only creates the table
-- and the column. Linking NEW quotes to a customer happens in application
-- code (app/api/quotes/route.ts, find-or-create by normalized email) as of
-- the commit that pairs with this migration. Backfilling EXISTING quotes
-- into customer records is a separate script (see
-- scripts/backfill-customers.mjs) — deliberately not done as part of this
-- schema migration, since it involves a real judgment call (grouping by
-- exact, case-insensitive email match only, no fuzzy name-matching) that's
-- easier to review, dry-run, and re-run safely as its own step than baked
-- into an irreversible ALTER TABLE migration.

CREATE TABLE IF NOT EXISTS public.customers (
  id bigserial PRIMARY KEY,
  tenant_id integer NOT NULL,
  name text,
  email text,
  phone text,
  company text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Normalized-email lookup is the actual find-or-create key (lowercase,
-- trimmed) — enforced as a real unique constraint so two concurrent quote
-- creations for a brand-new customer can't race into two duplicate
-- customer rows. NULL emails are exempt from uniqueness (a customer with
-- no email on file is fine; two of them existing isn't a conflict).
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_email_unique
  ON public.customers (tenant_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_tenant_idx ON public.customers (tenant_id);

ALTER TABLE public."quotes"
  ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES public.customers(id);

CREATE INDEX IF NOT EXISTS quotes_customer_id_idx ON public."quotes" (customer_id);
