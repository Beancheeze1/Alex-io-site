// app/api/my-quotes/route.ts
//
// Returns quotes assigned to the currently logged-in user.
// - Uses sales_rep_id on public."quotes".
// - Also returns commission_pct and computed commission_usd for the rep.
// - Read-only, Path A safe.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      Number.isFinite(Number(limitParam)) ? Number(limitParam) : 100,
      200,
    );

    const rows = await q<QuoteRow>(
      `
      SELECT id,
             quote_no,
             customer_name,
             email,
             phone,
             status,
             created_at,
             updated_at
      FROM public."quotes"
      WHERE sales_rep_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
      `,
      [user.id, limit],
    );

    // Commission summary for this rep
    const commissionRow = await one<{
      commission_pct: number | null;
      quotes_total_usd: number;
      commission_usd: number;
      quote_count: number;
    }>(
      `
      SELECT
        u.commission_pct,
        COALESCE(
          SUM(COALESCE(qi_totals.foam_total, 0))
          + SUM(COALESCE(box_totals.box_total, 0)),
          0
        )::numeric(10,2)  AS quotes_total_usd,
        ROUND(
          COALESCE(
            SUM(COALESCE(qi_totals.foam_total, 0))
            + SUM(COALESCE(box_totals.box_total, 0)),
            0
          ) * COALESCE(u.commission_pct, 0) / 100,
          2
        )                 AS commission_usd,
        COUNT(DISTINCT q.id)::int AS quote_count
      FROM public.users u
      LEFT JOIN public.quotes q ON q.sales_rep_id = u.id
      LEFT JOIN LATERAL (
        SELECT qi.quote_id,
               COALESCE(SUM(qi.price_total_usd), 0) AS foam_total
        FROM public.quote_items qi
        WHERE qi.quote_id = q.id
        GROUP BY qi.quote_id
      ) qi_totals ON true
      LEFT JOIN LATERAL (
        SELECT qbs.quote_id,
               COALESCE(SUM(qbs.extended_price_usd), 0) AS box_total
        FROM public.quote_box_selections qbs
        WHERE qbs.quote_id = q.id
        GROUP BY qbs.quote_id
      ) box_totals ON true
      WHERE u.id = $1
      GROUP BY u.id, u.commission_pct
      `,
      [user.id],
    );

    return NextResponse.json({
      ok: true,
      quotes: rows,
      commission: {
        pct: commissionRow?.commission_pct ?? null,
        quotes_total_usd: Number(commissionRow?.quotes_total_usd ?? 0),
        commission_usd: Number(commissionRow?.commission_usd ?? 0),
        quote_count: commissionRow?.quote_count ?? 0,
      },
    });
  } catch (err: any) {
    console.error("my-quotes GET error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}

