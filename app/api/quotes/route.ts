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
    const rows = await q(
      `
      SELECT id, quote_no, customer_name, email, phone, status, sales_rep_id, created_at, updated_at
      FROM public."quotes"
      ORDER BY created_at DESC
      LIMIT $1
    `,
      [limit],
    );
    return NextResponse.json({ ok: true, quotes: rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}

// POST /api/quotes
// {
//   "quote_no": "Q-API-001",
//   "customer_name": "Acme",
//   "email": "a@b.com",
//   "sales_rep_slug": "sales-demo" // optional
//   "sales_rep_id": 2              // optional (admin tooling)
// }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      quote_no,
      customer_name,
      email = null,
      phone = null,
      status = "draft",
      sales_rep_slug = null,
      sales_rep_id = null,
    } = body || {};

    if (!quote_no || !customer_name) {
      return NextResponse.json(
        { ok: false, error: "quote_no and customer_name are required" },
        { status: 400 },
      );
    }

    // Resolve sales_rep_id:
    //  - If caller passed a numeric sales_rep_id, trust it.
    //  - Else if sales_rep_slug is provided, look up users.id where sales_slug = $1.
    let resolvedSalesRepId: number | null = null;

    if (typeof sales_rep_id === "number" && Number.isFinite(sales_rep_id)) {
      resolvedSalesRepId = sales_rep_id;
    } else if (
      typeof sales_rep_id === "string" &&
      sales_rep_id.trim() &&
      !Number.isNaN(Number(sales_rep_id))
    ) {
      resolvedSalesRepId = Number(sales_rep_id);
    } else if (sales_rep_slug && typeof sales_rep_slug === "string") {
      try {
        const u = await one<any>(
          `
          SELECT id
          FROM public."users"
          WHERE sales_slug = $1
          LIMIT 1;
        `,
          [sales_rep_slug.trim()],
        );
        if (u && typeof u.id === "number") {
          resolvedSalesRepId = u.id;
        }
      } catch {
        // If the lookup fails for any reason, just leave resolvedSalesRepId as null.
      }
    }

    const row = await one(
      `
      INSERT INTO public."quotes"(quote_no, customer_name, email, phone, status, sales_rep_id)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (quote_no) DO UPDATE
        SET customer_name = EXCLUDED.customer_name,
            email         = EXCLUDED.email,
            phone         = EXCLUDED.phone,
            status        = EXCLUDED.status,
            sales_rep_id  = EXCLUDED.sales_rep_id,
            updated_at    = now()
      RETURNING id, quote_no, customer_name, email, phone, status, sales_rep_id, created_at, updated_at
    `,
      [quote_no, customer_name, email, phone, status, resolvedSalesRepId],
    );

    return NextResponse.json({ ok: true, quote: row }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
