-- 051_account_rep.sql
--
-- Step 39O: each customer can have an account rep (any staff member with a
-- sales slug: Sales, CS or admin). A quote for that customer is credited to
-- the account rep unless it came in on someone's /q/<slug> link or staff
-- chose "Commission to" on the Start new quote form.
--   customers.account_rep_id   users.id of the account rep (NULL = none)
--   quotes.rep_set_by_staff    staff chose the rep (or "No commission") on
--                              the form / quote page: never auto-filled
-- No foreign key on account_rep_id (removing a user clears it in
-- app/api/admin/cleanup/users). Idempotent.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS account_rep_id integer DEFAULT NULL;

CREATE INDEX IF NOT EXISTS customers_account_rep_idx
  ON public.customers (tenant_id, account_rep_id);

ALTER TABLE public."quotes"
  ADD COLUMN IF NOT EXISTS rep_set_by_staff boolean NOT NULL DEFAULT false;
