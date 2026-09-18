// app/lib/expense-periods.ts
//
// Shared plumbing for expense reimbursement periods. Imported by both the
// rep-facing route (/api/my-expenses/payouts) and the admin route
// (/api/admin/expenses/payouts) so there is exactly one implementation of
// "what does closing a period capture".
//
// THE RULE (and the whole point of this module):
//
//   A close captures every expense for that rep that is not yet attached to
//   any prior closed period -- full stop. It is NEVER filtered by whether
//   the expense's created_at falls inside the selected calendar month.
//
// The commission side originally scoped its close to `created_at >= month
// start AND < month end`, which meant a qualifying record from a month
// nobody explicitly closed was orphaned forever: live totals kept counting
// it, but no closed period ever captured it. A period here is "everything
// outstanding as of now", labelled with a month for human bookkeeping, so
// skipping a month (or back-dating an expense) can't strand anything.
//
// Membership is tracked by expenses.expense_payout_id. That same column is
// what locks a line item: non-null means it has been counted toward a closed
// period and the rep can no longer edit or remove it, mirroring how a locked
// (RFM) quote can't be changed after it counts toward commission.

import { q, one, withTxn } from "@/lib/db";

export type ClosePeriodResult = {
  user_id: number;
  period: string;
  /** created = new period row; updated = swept more into an existing unpaid
   *  period; already_paid = left alone; skipped_empty = nothing outstanding. */
  status: "created" | "updated" | "already_paid" | "skipped_empty";
  payout_id: number | null;
  expense_count: number;
  expense_total_usd: number;
  /** How many previously-unswept expenses this call captured. */
  swept: number;
};

export function isValidPeriod(period: unknown): period is string {
  return typeof period === "string" && /^\d{4}-\d{2}$/.test(period);
}

/**
 * Creates expense_payouts and the expenses.expense_payout_id link column if
 * they don't exist yet. migrations/019_expense_payouts.sql is the durable
 * definition; this is the same belt-and-braces the commission payouts route
 * already does, so the feature works on an environment that hasn't run
 * migrations yet.
 */
export async function ensureExpenseTables() {
  await one(
    `CREATE TABLE IF NOT EXISTS public.expenses (
      id            serial PRIMARY KEY,
      tenant_id     integer NOT NULL,
      user_id       integer NOT NULL,
      expense_type  text NOT NULL,
      miles         numeric(8,2) DEFAULT NULL,
      amount_usd    numeric(10,2) NOT NULL DEFAULT 0,
      notes         text DEFAULT NULL,
      created_at    timestamptz NOT NULL DEFAULT NOW()
    )`,
    [],
  ).catch(() => null);

  await one(
    `CREATE TABLE IF NOT EXISTS public.expense_payouts (
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
    )`,
    [],
  ).catch(() => null);

  await one(
    `ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS expense_payout_id integer DEFAULT NULL`,
    [],
  ).catch(() => null);

  await one(
    `CREATE INDEX IF NOT EXISTS expenses_payout_idx
       ON public.expenses (tenant_id, user_id, expense_payout_id)`,
    [],
  ).catch(() => null);
}

/**
 * Closes `period` for one rep: sweeps every outstanding expense of theirs
 * into the period and recomputes the period's totals from the swept rows.
 *
 * Idempotent. Re-closing an unpaid period picks up anything logged since and
 * re-derives the totals; an already-reimbursed period is never touched.
 */
export async function closeExpensePeriodForRep(
  tenantId: number,
  userId: number,
  period: string,
): Promise<ClosePeriodResult> {
  return withTxn(async (tx) => {
    const existing = (
      await tx.query<{ id: number; paid_at: string | null }>(
        `SELECT id, paid_at FROM public.expense_payouts
         WHERE tenant_id = $1 AND user_id = $2 AND period = $3
         FOR UPDATE`,
        [tenantId, userId, period],
      )
    ).rows[0];

    if (existing?.paid_at) {
      const frozen = (
        await tx.query<{ expense_total_usd: string; expense_count: number }>(
          `SELECT expense_total_usd, expense_count FROM public.expense_payouts WHERE id = $1`,
          [existing.id],
        )
      ).rows[0];
      return {
        user_id: userId,
        period,
        status: "already_paid",
        payout_id: existing.id,
        expense_count: Number(frozen?.expense_count ?? 0),
        expense_total_usd: Number(frozen?.expense_total_usd ?? 0),
        swept: 0,
      };
    }

    // Outstanding = not yet attached to ANY closed period. No date filter.
    const outstanding = (
      await tx.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM public.expenses
         WHERE tenant_id = $1 AND user_id = $2 AND expense_payout_id IS NULL`,
        [tenantId, userId],
      )
    ).rows[0];
    const outstandingCount = Number(outstanding?.c ?? 0);

    // Nothing to capture and no period row to refresh -> don't manufacture an
    // empty $0 period for a rep who logged no expenses.
    if (!existing && outstandingCount === 0) {
      return {
        user_id: userId, period, status: "skipped_empty", payout_id: null,
        expense_count: 0, expense_total_usd: 0, swept: 0,
      };
    }

    const payoutId = (
      await tx.query<{ id: number }>(
        `INSERT INTO public.expense_payouts (tenant_id, user_id, period, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (tenant_id, user_id, period)
           DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [tenantId, userId, period],
      )
    ).rows[0].id;

    const swept = (
      await tx.query(
        `UPDATE public.expenses SET expense_payout_id = $1
         WHERE tenant_id = $2 AND user_id = $3 AND expense_payout_id IS NULL`,
        [payoutId, tenantId, userId],
      )
    ).rowCount ?? 0;

    // Totals are derived from the linked rows themselves, never accumulated
    // separately -- so a period's total and the line items it locked can't
    // drift apart between the rep panel and the admin rollup.
    const totals = (
      await tx.query<{ expense_count: number; expense_total_usd: string }>(
        `SELECT COUNT(*)::int AS expense_count,
                COALESCE(SUM(amount_usd), 0)::text AS expense_total_usd
         FROM public.expenses WHERE expense_payout_id = $1`,
        [payoutId],
      )
    ).rows[0];

    await tx.query(
      `UPDATE public.expense_payouts
       SET expense_total_usd = $1, expense_count = $2, updated_at = NOW()
       WHERE id = $3`,
      [totals.expense_total_usd, totals.expense_count, payoutId],
    );

    return {
      user_id: userId,
      period,
      status: existing ? "updated" : "created",
      payout_id: payoutId,
      expense_count: Number(totals.expense_count),
      expense_total_usd: Number(totals.expense_total_usd),
      swept,
    };
  });
}

/** Sales reps in a tenant -- same definition the commission routes use. */
export async function listReps(tenantId: number) {
  return q<{ user_id: number; name: string; email: string; sales_slug: string }>(
    `SELECT id AS user_id, name, email, sales_slug
     FROM public.users
     WHERE tenant_id = $1 AND sales_slug IS NOT NULL AND sales_slug <> ''
     ORDER BY name ASC`,
    [tenantId],
  );
}
