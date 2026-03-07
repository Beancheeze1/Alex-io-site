// app/api/admin/commissions/payouts/route.ts
//
// Manages monthly commission payout snapshots.
//
// GET  — list all payout records for this tenant
// POST — "close month": snapshot current RFM totals into commission_payouts
// PATCH — mark a payout as paid (stamps paid_at) or unpaid (unpay: true)
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { getCommissionableTotal, safeNum } from "@/app/lib/commission-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) { return NextResponse.json(body, { status }); }
function bad(body: any, status = 400) { return NextResponse.json(body, { status }); }

async function ensureTables() {
  await one(
    `CREATE TABLE IF NOT EXISTS public.commission_payouts (
      id              serial PRIMARY KEY,
      tenant_id       integer NOT NULL,
      user_id         integer NOT NULL,
      period          char(7) NOT NULL,
      quotes_total_usd numeric(10,2) NOT NULL DEFAULT 0,
      commission_pct   numeric(5,2)  NOT NULL DEFAULT 0,
      commission_usd   numeric(10,2) NOT NULL DEFAULT 0,
      quote_count      integer       NOT NULL DEFAULT 0,
      paid_at          timestamptz   DEFAULT NULL,
      paid_by_user_id  integer       DEFAULT NULL,
      notes            text          DEFAULT NULL,
      created_at       timestamptz   NOT NULL DEFAULT NOW(),
      updated_at       timestamptz   NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, user_id, period)
    )`,
    [],
  ).catch(() => null);

  await one(
    `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) DEFAULT NULL`,
    [],
  ).catch(() => null);
}

// ── GET: list all payouts ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);
    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    await ensureTables();

    const payouts = await q<{
      id: number; user_id: number; name: string; email: string;
      sales_slug: string; period: string;
      quotes_total_usd: string; commission_pct: string; commission_usd: string;
      quote_count: number; paid_at: string | null; paid_by_name: string | null;
      notes: string | null; created_at: string;
    }>(
      `SELECT cp.id, cp.user_id, u.name, u.email, u.sales_slug,
              cp.period, cp.quotes_total_usd, cp.commission_pct, cp.commission_usd,
              cp.quote_count, cp.paid_at, pb.name AS paid_by_name,
              cp.notes, cp.created_at
       FROM public.commission_payouts cp
       JOIN public.users u  ON u.id = cp.user_id
       LEFT JOIN public.users pb ON pb.id = cp.paid_by_user_id
       WHERE cp.tenant_id = $1
       ORDER BY cp.period DESC, u.name ASC`,
      [user.tenant_id],
    );

    return ok({ ok: true, payouts });
  } catch (err: any) {
    console.error("payouts GET error:", err);
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
    const period: string = body?.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return bad({ ok: false, error: "invalid_period", message: "Expected period in YYYY-MM format." });
    }

    await ensureTables();

    const tenantId = user.tenant_id;
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const reps = await q<{ user_id: number; name: string; commission_pct: number | null }>(
      `SELECT id AS user_id, name, commission_pct
       FROM public.users
       WHERE tenant_id = $1 AND sales_slug IS NOT NULL AND sales_slug <> ''`,
      [tenantId],
    );

    const [year, month] = period.split("-").map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd   = new Date(year, month, 1);

    const results = await Promise.all(reps.map(async (rep) => {
      const quotes = await q<{ id: number; quote_no: string }>(
        `SELECT id, quote_no FROM public.quotes
         WHERE sales_rep_id = $1 AND tenant_id = $2
           AND locked = true
           AND created_at >= $3 AND created_at < $4`,
        [rep.user_id, tenantId, periodStart.toISOString(), periodEnd.toISOString()],
      );

      const totals = await Promise.all(
        quotes.map((qt) => getCommissionableTotal(qt.id, qt.quote_no, base)),
      );
      const quotesTotal = Math.round(totals.reduce((s, t) => s + t, 0) * 100) / 100;
      const pct = safeNum(rep.commission_pct);
      const commissionAmt = Math.round(quotesTotal * (pct / 100) * 100) / 100;

      await one(
        `INSERT INTO public.commission_payouts
           (tenant_id, user_id, period, quotes_total_usd, commission_pct, commission_usd, quote_count, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (tenant_id, user_id, period) DO UPDATE
           SET quotes_total_usd = EXCLUDED.quotes_total_usd,
               commission_pct   = EXCLUDED.commission_pct,
               commission_usd   = EXCLUDED.commission_usd,
               quote_count      = EXCLUDED.quote_count,
               updated_at       = NOW()
           WHERE commission_payouts.paid_at IS NULL`,
        [tenantId, rep.user_id, period, quotesTotal, pct, commissionAmt, quotes.length],
      );

      return { user_id: rep.user_id, name: rep.name, period, quotes_total_usd: quotesTotal, commission_usd: commissionAmt };
    }));

    return ok({ ok: true, period, results });
  } catch (err: any) {
    console.error("payouts POST error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

// ── PATCH: mark paid / unpaid ─────────────────────────────────────────────────

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

    await ensureTables();

    const updated = await one<{ id: number; paid_at: string | null }>(
      `UPDATE public.commission_payouts
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
    console.error("payouts PATCH error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
