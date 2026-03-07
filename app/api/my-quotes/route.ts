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

    // Commission summary — mirrors print route pricing exactly.
    // Pre-apply quotes have no quote_items; price from Redis facts instead.
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const repUser = await one<{ commission_pct: number | null }>(
      `SELECT commission_pct FROM public.users WHERE id = $1`,
      [user.id],
    );

    // Only RFM (locked=true) quotes count toward commission
    const myQuotes = await q<{ id: number; quote_no: string }>(
      `SELECT id, quote_no FROM public.quotes WHERE sales_rep_id = $1 AND locked = true`,
      [user.id],
    );

    let quotesTotalUsd = 0;

    if (myQuotes.length > 0) {
      const { getCommissionableTotal } = await import("@/app/lib/commission-pricing");
      const quoteTotals = await Promise.all(
        myQuotes.map(({ id, quote_no }) => getCommissionableTotal(id, quote_no, base)),
      );
      quotesTotalUsd = Math.round(quoteTotals.reduce((s, t) => s + t, 0) * 100) / 100;
    }

    const commPct = Number(repUser?.commission_pct ?? 0);
    const commissionUsd = Math.round(quotesTotalUsd * (commPct / 100) * 100) / 100;

    return NextResponse.json({
      ok: true,
      quotes: rows,
      commission: {
        pct: repUser?.commission_pct ?? null,
        quotes_total_usd: quotesTotalUsd,
        commission_usd: commissionUsd,
        quote_count: myQuotes.length,
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