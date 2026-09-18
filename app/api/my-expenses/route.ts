// app/api/my-expenses/route.ts
//
// Simple expense tracker for the logged-in rep -- lives on /admin/quotes
// alongside "Your sales link" / "Your commission".
//
// GET    — list the caller's own expenses (+ running totals).
// POST   — add an expense. For expense_type "mileage", the server computes
//          amount_usd = miles * the tenant's mileage_rate_usd (never trusts
//          a client-supplied amount for mileage, so the reimbursement math
//          can't be tampered with from the client). For "misc" (the Misc /
//          Special Items ledger) the caller supplies a description + amount
//          and no miles. Any other expense_type requires an explicit
//          amount_usd.
// DELETE — remove one of the caller's own expenses (mistake correction),
//          scoped to user_id + tenant_id so nobody can delete another rep's
//          row even by guessing an id.
//
// Locking: once an expense has been swept into a closed reimbursement period
// (expense_payout_id IS NOT NULL) it is frozen -- DELETE refuses it and the
// UI hides the Remove control, the same way a locked (RFM) quote can't be
// changed after it counts toward commission. See app/lib/expense-periods.ts.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { DEFAULT_MILEAGE_RATE_USD } from "@/app/api/admin/mileage-rate/route";
import { ensureExpenseTables } from "@/app/lib/expense-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "unauthorized" }, 401);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureExpenseTables();

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam != null ? Number(limitParam) : NaN;
    const limit = Math.min(
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100,
      200,
    );

    const expenses = await q<{
      id: number; expense_type: string; miles: string | null;
      amount_usd: string; notes: string | null; created_at: string;
      expense_payout_id: number | null; period: string | null;
      paid_at: string | null;
    }>(
      `SELECT e.id, e.expense_type, e.miles, e.amount_usd, e.notes, e.created_at,
              e.expense_payout_id, ep.period, ep.paid_at
       FROM public.expenses e
       LEFT JOIN public.expense_payouts ep ON ep.id = e.expense_payout_id
       WHERE e.user_id = $1 AND e.tenant_id = $2
       ORDER BY e.created_at DESC
       LIMIT $3`,
      [user.id, user.tenant_id, limit],
    );

    // Totals come from an aggregate over the whole ledger, not from the
    // page of rows above -- otherwise `limit` would silently change the
    // headline number and stop it matching the admin rollup.
    const agg = await one<{
      all_total: string; all_count: number;
      outstanding_total: string; outstanding_count: number;
    }>(
      `SELECT COALESCE(SUM(amount_usd), 0)::text AS all_total,
              COUNT(*)::int AS all_count,
              COALESCE(SUM(amount_usd) FILTER (WHERE expense_payout_id IS NULL), 0)::text AS outstanding_total,
              COUNT(*) FILTER (WHERE expense_payout_id IS NULL)::int AS outstanding_count
       FROM public.expenses
       WHERE user_id = $1 AND tenant_id = $2`,
      [user.id, user.tenant_id],
    );

    return ok({
      ok: true,
      expenses: expenses.map((e) => ({ ...e, locked: e.expense_payout_id != null })),
      total_usd: Number(agg?.all_total ?? 0),
      total_count: Number(agg?.all_count ?? 0),
      outstanding_usd: Number(agg?.outstanding_total ?? 0),
      outstanding_count: Number(agg?.outstanding_count ?? 0),
    });
  } catch (err: any) {
    console.error("my-expenses GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "unauthorized" }, 401);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureExpenseTables();

    const body = await req.json().catch(() => ({}));
    const expenseType = String(body?.expense_type || "").trim();
    let notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 500) : null;

    if (!expenseType) {
      return bad({ ok: false, error: "invalid_type", message: "Expense type is required." });
    }

    let miles: number | null = null;
    let amountUsd: number;

    if (expenseType === "mileage") {
      miles = Number(body?.miles);
      if (!Number.isFinite(miles) || miles <= 0) {
        return bad({ ok: false, error: "invalid_miles", message: "Miles must be a positive number." });
      }

      const rateRow = await one<{ mileage_rate_usd: string | null }>(
        `SELECT mileage_rate_usd FROM public.tenants WHERE id = $1`,
        [user.tenant_id],
      );
      const rate = rateRow?.mileage_rate_usd != null ? Number(rateRow.mileage_rate_usd) : DEFAULT_MILEAGE_RATE_USD;

      amountUsd = Math.round(miles * rate * 100) / 100;
    } else {
      // "misc" (Misc / Special Items) is a description + amount line with no
      // miles and no rate math. The description is that row's free-text
      // field, so it rides in `notes` -- one ledger, one period pipeline,
      // no second table and no column only one type ever uses.
      if (expenseType === "misc") {
        const description =
          typeof body?.description === "string" ? body.description.trim().slice(0, 500) : "";
        if (!description) {
          return bad({ ok: false, error: "invalid_description", message: "Description is required." });
        }
        notes = description;
      }

      amountUsd = Number(body?.amount_usd);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        return bad({ ok: false, error: "invalid_amount", message: "Amount must be a positive number." });
      }
      amountUsd = Math.round(amountUsd * 100) / 100;
    }

    const row = await one<{
      id: number; expense_type: string; miles: string | null;
      amount_usd: string; notes: string | null; created_at: string;
      expense_payout_id: number | null;
    }>(
      `INSERT INTO public.expenses (tenant_id, user_id, expense_type, miles, amount_usd, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expense_type, miles, amount_usd, notes, created_at, expense_payout_id`,
      [user.tenant_id, user.id, expenseType, miles, amountUsd, notes],
    );

    return ok({ ok: true, expense: row ? { ...row, locked: false } : row });
  } catch (err: any) {
    console.error("my-expenses POST error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "unauthorized" }, 401);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureExpenseTables();

    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return bad({ ok: false, error: "invalid_id" });
    }

    // `expense_payout_id IS NULL` in the WHERE clause is the lock: an expense
    // already counted toward a closed period can't be deleted out from under
    // the reimbursement it was part of.
    const deleted = await one<{ id: number }>(
      `DELETE FROM public.expenses
       WHERE id = $1 AND user_id = $2 AND tenant_id = $3 AND expense_payout_id IS NULL
       RETURNING id`,
      [id, user.id, user.tenant_id],
    );

    if (!deleted?.id) {
      const existing = await one<{ expense_payout_id: number | null }>(
        `SELECT expense_payout_id FROM public.expenses
         WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
        [id, user.id, user.tenant_id],
      );
      if (existing?.expense_payout_id != null) {
        return bad({
          ok: false,
          error: "locked",
          message: "This expense is part of a closed reimbursement period and can no longer be changed.",
        }, 409);
      }
      return bad({ ok: false, error: "not_found" }, 404);
    }

    return ok({ ok: true, id: deleted.id });
  } catch (err: any) {
    console.error("my-expenses DELETE error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
