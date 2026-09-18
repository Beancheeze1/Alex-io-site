-- 019_expense_payouts.sql
--
-- Monthly expense reimbursement periods for sales reps, mirroring the
-- existing commission_payouts snapshot table.
--
-- The one deliberate difference from commissions: what a period captures is
-- tracked by an explicit link column on `expenses` (expense_payout_id), not
-- by a created_at date range. A period means "everything outstanding as of
-- the moment it was closed", so an expense logged in (or back-dated to) a
-- month nobody ever closed can never be orphaned -- the next close that runs
-- sweeps it up regardless of which calendar month it belongs to.
--
-- expense_payout_id also drives locking: a non-null value means the row has
-- been counted toward a closed period and is no longer editable/removable,
-- the same way a locked (RFM) quote can't be changed once it counts toward
-- commission.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

-- `expenses` is created lazily by /api/my-expenses on environments that
-- predate this migration; spelled out here too so the migration is valid
-- standalone on a fresh database (definition matches that route exactly).
CREATE TABLE IF NOT EXISTS public.expenses (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  user_id       integer NOT NULL,
  expense_type  text NOT NULL,
  miles         numeric(8,2) DEFAULT NULL,
  amount_usd    numeric(10,2) NOT NULL DEFAULT 0,
  notes         text DEFAULT NULL,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_payouts (
  id                 serial PRIMARY KEY,
  tenant_id          integer       NOT NULL,
  user_id            integer       NOT NULL,
  period             char(7)       NOT NULL,
  expense_total_usd  numeric(10,2) NOT NULL DEFAULT 0,
  expense_count      integer       NOT NULL DEFAULT 0,
  paid_at            timestamptz   DEFAULT NULL,
  paid_by_user_id    integer       DEFAULT NULL,
  notes              text          DEFAULT NULL,
  created_at         timestamptz   NOT NULL DEFAULT NOW(),
  updated_at         timestamptz   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, period)
);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_payout_id integer DEFAULT NULL;

CREATE INDEX IF NOT EXISTS expenses_payout_idx
  ON public.expenses (tenant_id, user_id, expense_payout_id);
