// app/api/quotes/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";

// GET /api/quotes?limit=50
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10),
      200,
    );
    const rows = await q(
      `
      SELECT id,
             quote_no,
             customer_name,
             email,
             phone,
             status,
             sales_rep_id,
             created_at,
             updated_at
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
// Request shape (now supports rep attribution):
// {
//   "quote_no": "Q-API-001",
//   "customer_name": "Acme",
//   "email": "a@b.com",
//   "phone": "555-1234",
//   "status": "draft",
//   "sales_rep_id": 2,          // optional, direct id (admin tools)
//   "sales_rep_slug": "chuck"   // optional, looked up via users.sales_slug
// }
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) || {};

    const {
      quote_no,
      customer_name,
      email = null,
      phone = null,
      status = "draft",
      sales_rep_id: rawSalesRepId,
      sales_rep_slug: rawSalesRepSlug,
    } = body;

    if (!quote_no || !customer_name) {
      return NextResponse.json(
        { ok: false, error: "quote_no and customer_name are required" },
        { status: 400 },
      );
    }

    // Resolve sales_rep_id:
    // 1) If a numeric id was provided, trust it.
    // 2) Else, if a slug was provided, look up users.id where sales_slug = slug.
    let salesRepId: number | null = null;

    if (
      rawSalesRepId !== undefined &&
      rawSalesRepId !== null &&
      Number.isFinite(Number(rawSalesRepId))
    ) {
      salesRepId = Number(rawSalesRepId);
    } else if (rawSalesRepSlug) {
      const slug = String(rawSalesRepSlug).trim();
      if (slug) {
        try {
          const userRow = await one<any>(
            `
            SELECT id
            FROM public."users"
            WHERE sales_slug = $1
            LIMIT 1;
          `,
            [slug],
          );
          if (userRow && userRow.id) {
            salesRepId = Number(userRow.id);
          }
        } catch {
          // If lookup fails, we just proceed without assigning a rep.
          salesRepId = null;
        }
      }
    }

    const row = await one(
      `
      INSERT INTO public."quotes"(
        quote_no,
        customer_name,
        email,
        phone,
        status,
        sales_rep_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (quote_no) DO UPDATE
        SET customer_name = EXCLUDED.customer_name,
            email         = EXCLUDED.email,
            phone         = EXCLUDED.phone,
            status        = EXCLUDED.status,
            -- Only update sales_rep_id if a new non-null value was provided;
            -- otherwise keep the existing assignment.
            sales_rep_id  = COALESCE(EXCLUDED.sales_rep_id, public."quotes".sales_rep_id),
            updated_at    = now()
      RETURNING id,
                quote_no,
                customer_name,
                email,
                phone,
                status,
                sales_rep_id,
                created_at,
                updated_at
    `,
      [quote_no, customer_name, email, phone, status, salesRepId],
    );

    return NextResponse.json({ ok: true, quote: row }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
