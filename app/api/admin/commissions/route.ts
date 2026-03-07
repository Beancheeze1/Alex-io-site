// app/api/admin/commissions/route.ts
//
// Returns live commission summary for all sales reps in the tenant.
// Only counts quotes where locked = true (RFM status).
// Uses shared getCommissionableTotal which mirrors print route pricing exactly,
// including synthetic box matching for customer_box_in facts.
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

export type CommissionRow = {
  user_id: number; name: string; email: string; sales_slug: string;
  commission_pct: number | null; quote_count: number;
  quotes_total_usd: number; commission_usd: number;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || user.role !== "admin") return bad({ ok: false, error: "forbidden" }, 403);

    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const tenantId = user.tenant_id;

    await one(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) DEFAULT NULL`, []).catch(() => null);

    const reps = await q<{
      user_id: number; name: string; email: string;
      sales_slug: string; commission_pct: number | null;
    }>(
      `SELECT id AS user_id, name, email, sales_slug, commission_pct
       FROM public.users
       WHERE tenant_id = $1 AND sales_slug IS NOT NULL AND sales_slug <> ''
       ORDER BY name ASC`,
      [tenantId],
    );

    if (!reps || reps.length === 0) return ok({ ok: true, rows: [] });

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const rows: CommissionRow[] = await Promise.all(
      reps.map(async (rep) => {
        const quotes = await q<{ id: number; quote_no: string }>(
          `SELECT id, quote_no FROM public.quotes
           WHERE sales_rep_id = $1 AND tenant_id = $2 AND locked = true`,
          [rep.user_id, tenantId],
        );

        if (quotes.length === 0) {
          return { ...rep, quote_count: 0, quotes_total_usd: 0, commission_usd: 0 };
        }

        const quoteTotals = await Promise.all(
          quotes.map((qt) => getCommissionableTotal(qt.id, qt.quote_no, base)),
        );

        const quotesTotal = Math.round(quoteTotals.reduce((s, t) => s + t, 0) * 100) / 100;
        const pct = safeNum(rep.commission_pct);
        const commissionAmt = Math.round(quotesTotal * (pct / 100) * 100) / 100;

        return {
          user_id: rep.user_id,
          name: rep.name,
          email: rep.email,
          sales_slug: rep.sales_slug,
          commission_pct: rep.commission_pct,
          quote_count: quotes.length,
          quotes_total_usd: quotesTotal,
          commission_usd: commissionAmt,
        };
      }),
    );

    rows.sort((a, b) => b.quotes_total_usd - a.quotes_total_usd);
    return ok({ ok: true, rows });
  } catch (err: any) {
    console.error("commissions GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
