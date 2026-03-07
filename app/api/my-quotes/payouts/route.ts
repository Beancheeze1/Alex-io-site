// app/api/my-quotes/payouts/route.ts
//
// Returns commission payout history for the currently logged-in sales rep.
// Read-only — reps can see their own history only.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    const payouts = await q<{
      id: number; period: string;
      quotes_total_usd: string; commission_pct: string; commission_usd: string;
      quote_count: number; paid_at: string | null; created_at: string;
    }>(
      `SELECT id, period, quotes_total_usd, commission_pct, commission_usd,
              quote_count, paid_at, created_at
       FROM public.commission_payouts
       WHERE user_id = $1 AND tenant_id = $2
       ORDER BY period DESC`,
      [user.id, user.tenant_id],
    ).catch(() => []);

    return NextResponse.json({ ok: true, payouts });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
