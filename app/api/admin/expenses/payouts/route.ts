// app/api/admin/expenses/payouts/route.ts
//
// Manages expense reimbursement periods across all reps in the tenant --
// the expense-side counterpart to /api/admin/commissions/payouts.
//
// GET   — list all expense period records for this tenant
// POST  — "close a month": sweep every rep's outstanding expenses into the
//         named period. See app/lib/expense-periods.ts -- the sweep is by
//         "not yet in any closed period", never by created_at month, so a
//         skipped month can't orphan an expense.
// PATCH — mark a period reimbursed (stamps paid_at) or undo (unpay: true)
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import {
  ensureExpenseTables,
  closeExpensePeriodForRep,
  isValidPeriod,
  listReps,
} from "@/app/lib/expense-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

// ── GET: list all expense periods ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureExpenseTables();

    const payouts = await q<{
      id: number; user_id: number; name: string; email: string;
      sales_slug: string; period: string;
      expense_total_usd: string; expense_count: number;
      paid_at: string | null; paid_by_name: string | null;
      notes: string | null; created_at: string;
    }>(
      `SELECT ep.id, ep.user_id, u.name, u.email, u.sales_slug,
              ep.period, ep.expense_total_usd, ep.expense_count,
              ep.paid_at, pb.name AS paid_by_name,
              ep.notes, ep.created_at
       FROM public.expense_payouts ep
       JOIN public.users u  ON u.id = ep.user_id
       LEFT JOIN public.users pb ON pb.id = ep.paid_by_user_id
       WHERE ep.tenant_id = $1
       ORDER BY ep.period DESC, u.name ASC`,
      [user.tenant_id],
    );

    return ok({ ok: true, payouts });
  } catch (err: any) {
    console.error("expense payouts GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

// ── POST: close a month ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const period = body?.period;
    if (!isValidPeriod(period)) {
      return bad({ ok: false, error: "invalid_period", message: "Expected period in YYYY-MM format." });
    }

    await ensureExpenseTables();

    const reps = await listReps(user.tenant_id);

    // Sequential rather than Promise.all: each rep's close is its own
    // transaction taking a FOR UPDATE lock, and there is no per-rep latency
    // to hide here (unlike commissions, which fetches priced quotes).
    const results = [];
    for (const rep of reps) {
      const r = await closeExpensePeriodForRep(user.tenant_id, rep.user_id, period);
      results.push({ ...r, name: rep.name });
    }

    const captured = results.filter((r) => r.status === "created" || r.status === "updated");
    return ok({
      ok: true,
      period,
      results,
      closed_count: captured.length,
      swept_count: results.reduce((s, r) => s + r.swept, 0),
    });
  } catch (err: any) {
    console.error("expense payouts POST error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

// ── PATCH: mark reimbursed / undo ─────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    const unpay = body?.unpay === true;

    if (!Number.isFinite(id) || id <= 0) {
      return bad({ ok: false, error: "invalid_id", message: "Expected { id }" });
    }

    await ensureExpenseTables();

    const updated = await one<{ id: number; paid_at: string | null }>(
      `UPDATE public.expense_payouts
       SET paid_at         = ${unpay ? "NULL" : "NOW()"},
           paid_by_user_id = ${unpay ? "NULL" : "$2"},
           updated_at      = NOW()
       WHERE id = $1 AND tenant_id = ${unpay ? "$2" : "$3"}
       RETURNING id, paid_at`,
      unpay ? [id, user.tenant_id] : [id, user.id, user.tenant_id],
    );

    if (!updated?.id) return bad({ ok: false, error: "not_found" }, 404);
    return ok({ ok: true, id: updated.id, paid_at: updated.paid_at });
  } catch (err: any) {
    console.error("expense payouts PATCH error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
