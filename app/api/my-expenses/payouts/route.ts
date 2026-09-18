// app/api/my-expenses/payouts/route.ts
//
// Expense reimbursement periods for the currently logged-in sales rep.
// Mirrors /api/my-quotes/payouts, plus a close action so a rep can submit
// their own outstanding expenses as a period from the panel on /admin/quotes.
//
// GET  — this rep's own period history (read-only, own rows only).
// POST — close a period for this rep: sweeps every expense of theirs not yet
//        in a closed period. Deliberately NOT filtered by calendar month --
//        see app/lib/expense-periods.ts for why.
//
// Marking a period reimbursed stays admin-only (/api/admin/expenses/payouts).

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import {
  ensureExpenseTables,
  closeExpensePeriodForRep,
  isValidPeriod,
} from "@/app/lib/expense-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "unauthorized" }, 401);

    await ensureExpenseTables();

    const payouts = await q<{
      id: number; period: string; expense_total_usd: string;
      expense_count: number; paid_at: string | null; created_at: string;
    }>(
      `SELECT id, period, expense_total_usd, expense_count, paid_at, created_at
       FROM public.expense_payouts
       WHERE user_id = $1 AND tenant_id = $2
       ORDER BY period DESC`,
      [user.id, user.tenant_id],
    ).catch(() => []);

    return ok({ ok: true, payouts });
  } catch (err: any) {
    console.error("my-expenses payouts GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "unauthorized" }, 401);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const period = body?.period;
    if (!isValidPeriod(period)) {
      return bad({ ok: false, error: "invalid_period", message: "Expected period in YYYY-MM format." });
    }

    await ensureExpenseTables();

    const result = await closeExpensePeriodForRep(user.tenant_id, user.id, period);

    if (result.status === "already_paid") {
      return bad({
        ok: false,
        error: "already_reimbursed",
        message: "That period has already been reimbursed and can't be reopened.",
      }, 409);
    }
    if (result.status === "skipped_empty") {
      return bad({
        ok: false,
        error: "nothing_outstanding",
        message: "You have no outstanding expenses to close.",
      }, 409);
    }

    return ok({ ok: true, period, result });
  } catch (err: any) {
    console.error("my-expenses payouts POST error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
