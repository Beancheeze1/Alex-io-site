// app/api/my-quotes/route.ts
//
// Returns quotes assigned to the currently logged-in user.
// - Uses sales_rep_id on public."quotes".
// - Read-only, Path A safe.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
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

    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10),
      200,
    );

    const rows = await q<QuoteRow>(
      `
      SELECT id, quote_no, customer_name, email, phone, status, created_at, updated_at
      FROM public."quotes"
      WHERE sales_rep_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
      `,
      [user.id, limit],
    );

    return NextResponse.json({ ok: true, quotes: rows });
  } catch (err: any) {
    console.error("my-quotes GET error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
