// app/api/my-expenses/route.ts
//
// Simple expense tracker for the logged-in rep -- lives on /admin/quotes
// alongside "Your sales link" / "Your commission".
//
// GET    — list the caller's own expenses (+ running total).
// POST   — add an expense. For expense_type "mileage", the server computes
//          amount_usd = miles * the tenant's mileage_rate_usd (never trusts
//          a client-supplied amount for mileage, so the reimbursement math
//          can't be tampered with from the client). Any other expense_type
//          requires an explicit amount_usd.
// DELETE — remove one of the caller's own expenses (mistake correction),
//          scoped to user_id + tenant_id so nobody can delete another rep's
//          row even by guessing an id.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { DEFAULT_MILEAGE_RATE_USD } from "@/app/api/admin/mileage-rate/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

async function ensureTable() {
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
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad({ ok: false, error: "unauthorized" }, 401);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureTable();

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
    }>(
      `SELECT id, expense_type, miles, amount_usd, notes, created_at
       FROM public.expenses
       WHERE user_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [user.id, user.tenant_id, limit],
    );

    const total = Math.round(
      expenses.reduce((s, e) => s + Number(e.amount_usd), 0) * 100,
    ) / 100;

    return ok({ ok: true, expenses, total_usd: total });
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

    await ensureTable();

    const body = await req.json().catch(() => ({}));
    const expenseType = String(body?.expense_type || "").trim();
    const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 500) : null;

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
      amountUsd = Number(body?.amount_usd);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        return bad({ ok: false, error: "invalid_amount", message: "Amount must be a positive number." });
      }
      amountUsd = Math.round(amountUsd * 100) / 100;
    }

    const row = await one<{
      id: number; expense_type: string; miles: string | null;
      amount_usd: string; notes: string | null; created_at: string;
    }>(
      `INSERT INTO public.expenses (tenant_id, user_id, expense_type, miles, amount_usd, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expense_type, miles, amount_usd, notes, created_at`,
      [user.tenant_id, user.id, expenseType, miles, amountUsd, notes],
    );

    return ok({ ok: true, expense: row });
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

    await ensureTable();

    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return bad({ ok: false, error: "invalid_id" });
    }

    const deleted = await one<{ id: number }>(
      `DELETE FROM public.expenses WHERE id = $1 AND user_id = $2 AND tenant_id = $3 RETURNING id`,
      [id, user.id, user.tenant_id],
    );

    if (!deleted?.id) return bad({ ok: false, error: "not_found" }, 404);
    return ok({ ok: true, id: deleted.id });
  } catch (err: any) {
    console.error("my-expenses DELETE error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
