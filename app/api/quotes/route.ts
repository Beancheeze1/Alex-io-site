// app/api/quotes/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";

// GET /api/quotes?limit=50
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
    const rows = await q(`
      SELECT id, quote_no, customer_name, email, phone, status, created_at, updated_at
      FROM public."quotes"
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    return NextResponse.json({ ok: true, quotes: rows });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

// POST /api/quotes
// { "quote_no":"Q-API-001", "customer_name":"Acme", "email":"a@b.com" }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { quote_no, customer_name, email = null, phone = null, status = "draft" } = body || {};
    if (!quote_no || !customer_name) {
      return NextResponse.json({ ok: false, error: "quote_no and customer_name are required" }, { status: 400 });
    }
    const row = await one(`
      INSERT INTO public."quotes"(quote_no, customer_name, email, phone, status)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (quote_no) DO UPDATE
        SET customer_name = EXCLUDED.customer_name,
            email         = EXCLUDED.email,
            phone         = EXCLUDED.phone,
            status        = EXCLUDED.status,
            updated_at    = now()
      RETURNING id, quote_no, customer_name, email, phone, status, created_at, updated_at
    `, [quote_no, customer_name, email, phone, status]);
    return NextResponse.json({ ok: true, quote: row }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
