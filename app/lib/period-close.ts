// app/lib/period-close.ts
//
// Generic "close a period" sweep primitive shared by commission and expense
// reimbursement periods. See app/lib/expense-periods.ts for the pattern
// this generalizes and the full story on why: a close must capture every
// qualifying row for a rep that is not yet linked to ANY prior closed
// period -- full stop, NEVER filtered by created_at falling inside the
// selected calendar month. Filtering by date let a qualifying record from a
// month nobody explicitly closed get permanently orphaned (live totals kept
// counting it, but no closed period ever captured it).
//
// This module only handles the part that's identical across payout
// domains: lock the payout row for (tenant, rep, period), find what's
// currently outstanding in the source table for that rep, and atomically
// link those rows to the payout so they can't be swept again by a later
// close (that link column is also what LOCKS the source row from further
// edits -- see callers).
//
// Computing the payout row's domain totals (dollar amounts, commission
// rate, etc.) deliberately stays OUTSIDE this primitive and is left to each
// caller: expenses can derive a total with a plain SQL SUM over a column
// already on the row, but commissions must re-price each swept quote via
// an external, non-transactional call (quote_items/box pricing plus an
// HTTP round trip to /api/quotes/calc) that has no business holding a DB
// transaction open. Callers finish the close by persisting their own
// totals onto the payout row this returns.
//
// Used by:
//   - app/api/admin/commissions/payouts/route.ts (month close)
// expense-periods.ts intentionally does NOT route through this yet -- it
// already has its own verified, working implementation of the same shape,
// and there's no reason to touch tested code to satisfy a "share
// everything" itch. New domains should prefer this primitive going
// forward.

import type { PoolClient } from "pg";
import { withTxn } from "@/lib/db";

export type SweepConfig = {
  /** Payout table, e.g. "public.commission_payouts". Must have columns
   *  (id, tenant_id, user_id, period, paid_at) with a UNIQUE (tenant_id,
   *  user_id, period) constraint. */
  payoutTable: string;
  /** Source table being swept, e.g. "public.quotes". Must have a
   *  tenant_id column. */
  sourceTable: string;
  /** Column on sourceTable identifying the rep, e.g. "sales_rep_id". */
  sourceRepColumn: string;
  /** Column on sourceTable linking a row to the payout that swept it,
   *  e.g. "commission_payout_id". NULL = outstanding / unlocked. */
  linkColumn: string;
  /** Extra qualifying SQL condition on sourceTable rows, appended as-is,
   *  e.g. "AND locked = true". Optional. */
  sourceExtraWhere?: string;
  /** Columns to select from sourceTable, e.g. "id, quote_no". Must
   *  include "id". */
  sourceSelectColumns: string;
};

export type SweepStatus = "already_paid" | "created" | "updated" | "skipped_empty";

export type SweepResult<Row> = {
  /** already_paid = period was already reimbursed/paid, left untouched.
   *  created = new payout row, something was swept into it.
   *  updated = existing unpaid payout row, more was swept into it.
   *  skipped_empty = no payout row existed and nothing was outstanding --
   *  no $0 row is manufactured for a rep with nothing to report. */
  status: SweepStatus;
  /** Existing or newly-created payout row id. Null only on skipped_empty. */
  payoutId: number | null;
  /** Rows newly linked to the payout by THIS call. Empty on
   *  already_paid/skipped_empty. */
  sweptRows: Row[];
  /** Every row currently linked to the payout (prior sweeps + this one) --
   *  what a caller should re-derive its totals from, so re-closing an
   *  unpaid period after new activity recomputes the whole period, not
   *  just the delta. Empty on already_paid/skipped_empty. */
  allLinkedRows: Row[];
};

/**
 * Locks/creates the payout row for (tenantId, repUserId, period) and sweeps
 * every outstanding sourceTable row for that rep into it. Idempotent: safe
 * to call again on an unpaid period (picks up anything new since, from any
 * date), a no-op on a paid one.
 */
export async function sweepPeriod<Row extends { id: number } = { id: number }>(
  cfg: SweepConfig,
  tenantId: number,
  repUserId: number,
  period: string,
): Promise<SweepResult<Row>> {
  return withTxn(async (tx: PoolClient) => {
    const existing = (
      await tx.query<{ id: number; paid_at: string | null }>(
        `SELECT id, paid_at FROM ${cfg.payoutTable}
         WHERE tenant_id = $1 AND user_id = $2 AND period = $3
         FOR UPDATE`,
        [tenantId, repUserId, period],
      )
    ).rows[0];

    if (existing?.paid_at) {
      return { status: "already_paid" as const, payoutId: existing.id, sweptRows: [] as Row[], allLinkedRows: [] as Row[] };
    }

    // Outstanding = not yet linked to ANY closed period for this rep, full
    // stop. No date filter -- this is the entire point of this module.
    const outstanding = (
      await tx.query<Row>(
        `SELECT ${cfg.sourceSelectColumns} FROM ${cfg.sourceTable}
         WHERE tenant_id = $1 AND ${cfg.sourceRepColumn} = $2 AND ${cfg.linkColumn} IS NULL
         ${cfg.sourceExtraWhere || ""}`,
        [tenantId, repUserId],
      )
    ).rows;

    if (!existing && outstanding.length === 0) {
      return { status: "skipped_empty" as const, payoutId: null, sweptRows: [] as Row[], allLinkedRows: [] as Row[] };
    }

    const payoutId = (
      await tx.query<{ id: number }>(
        `INSERT INTO ${cfg.payoutTable} (tenant_id, user_id, period, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (tenant_id, user_id, period) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [tenantId, repUserId, period],
      )
    ).rows[0].id;

    if (outstanding.length > 0) {
      const ids = outstanding.map((r) => r.id);
      await tx.query(
        `UPDATE ${cfg.sourceTable} SET ${cfg.linkColumn} = $1 WHERE id = ANY($2::int[])`,
        [payoutId, ids],
      );
    }

    const allLinked = (
      await tx.query<Row>(
        `SELECT ${cfg.sourceSelectColumns} FROM ${cfg.sourceTable} WHERE ${cfg.linkColumn} = $1`,
        [payoutId],
      )
    ).rows;

    return {
      status: (existing ? "updated" : "created") as SweepStatus,
      payoutId,
      sweptRows: outstanding,
      allLinkedRows: allLinked,
    };
  });
}
