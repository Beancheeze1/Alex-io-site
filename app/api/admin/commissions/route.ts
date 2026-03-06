// app/api/admin/commissions/route.ts
//
// Returns commission summary for all sales reps in the tenant.
// For each rep with a sales_slug, aggregates the grand total from all
// their quotes (sum of quote_items.price_total_usd + box selections)
// and computes commission_pct × total.
//
// Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}
function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

export type CommissionRow = {
  user_id: number;
  name: string;
  email: string;
  sales_slug: string;
  commission_pct: number | null;
  quote_count: number;
  quotes_total_usd: number;
  commission_usd: number;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user || (user.role !== "admin")) {
      return bad({ ok: false, error: "forbidden" }, 403);
    }

    const ten = await enforceTenantMatch(req, user);
    if (!ten.ok) return NextResponse.json(ten.body, { status: ten.status });

    const tenantId = user.tenant_id;

    // Ensure commission_pct column exists
    await one(
      `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) DEFAULT NULL`,
      [],
    ).catch(() => null);

    // For each sales rep, sum up:
    //   - quote_items.price_total_usd  (foam)
    //   - quote_box_selections.extended_price_usd  (packaging)
    // grouped by their user id. Only include quotes from this tenant.
    const rows = await q<CommissionRow>(
      `
      SELECT
        u.id                                          AS user_id,
        u.name,
        u.email,
        u.sales_slug,
        u.commission_pct,
        COUNT(DISTINCT q.id)::int                    AS quote_count,
        COALESCE(
          SUM(COALESCE(qi_totals.foam_total, 0))
          + SUM(COALESCE(box_totals.box_total, 0)),
          0
        )::numeric(10,2)                             AS quotes_total_usd,
        ROUND(
          COALESCE(
            SUM(COALESCE(qi_totals.foam_total, 0))
            + SUM(COALESCE(box_totals.box_total, 0)),
            0
          ) * COALESCE(u.commission_pct, 0) / 100,
          2
        )                                            AS commission_usd
      FROM public.users u
      -- Only reps with a slug
      INNER JOIN public.quotes q
        ON q.sales_rep_id = u.id
        AND q.tenant_id   = u.tenant_id
      -- Foam subtotal per quote
      LEFT JOIN LATERAL (
        SELECT qi.quote_id,
               COALESCE(SUM(qi.price_total_usd), 0) AS foam_total
        FROM public.quote_items qi
        WHERE qi.quote_id = q.id
        GROUP BY qi.quote_id
      ) qi_totals ON true
      -- Box subtotal per quote
      LEFT JOIN LATERAL (
        SELECT qbs.quote_id,
               COALESCE(SUM(qbs.extended_price_usd), 0) AS box_total
        FROM public.quote_box_selections qbs
        WHERE qbs.quote_id = q.id
        GROUP BY qbs.quote_id
      ) box_totals ON true
      WHERE u.tenant_id  = $1
        AND u.sales_slug IS NOT NULL
        AND u.sales_slug <> ''
      GROUP BY u.id, u.name, u.email, u.sales_slug, u.commission_pct
      ORDER BY quotes_total_usd DESC
      `,
      [tenantId],
    );

    return ok({ ok: true, rows });
  } catch (err: any) {
    console.error("commissions GET error:", err);
    return bad({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}
