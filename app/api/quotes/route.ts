// app/api/quotes/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { q, one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

// GET /api/quotes?limit=25
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", message: "Login required." },
        { status: 401 },
      );
    }

    // Only internal roles should read quotes here.
    const isAdminOrCS = isRoleAllowed(user, ["admin", "cs"]);
    const isSales = isRoleAllowed(user, ["sales"]);

    if (!isAdminOrCS && !isSales) {
      return NextResponse.json(
        { ok: false, error: "forbidden", message: "Not allowed." },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 200);

    if (isSales) {
      // Sales can only see their own quotes.
      const rows = await q(
        `
        SELECT q.id,
               q.quote_no,
               q.customer_name,
               q.email,
               q.phone,
               q.status,
               q.sales_rep_id,
               u.name AS sales_rep_name,
               q.locked,
               q.geometry_hash,
               q.locked_at,
               q.created_at,
               q.updated_at
        FROM public."quotes" q
        LEFT JOIN public."users" u
          ON u.id = q.sales_rep_id
        WHERE sales_rep_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
        [user.id, limit],
      );

      return NextResponse.json({ ok: true, quotes: rows });
    }

    // Admin + CS: all quotes
    const rows = await q(
      `
      SELECT q.id,
             q.quote_no,
             q.customer_name,
             q.email,
             q.phone,
             q.status,
             q.sales_rep_id,
             u.name AS sales_rep_name,
             q.locked,
             q.geometry_hash,
             q.locked_at,
             q.created_at,
             q.updated_at
      FROM public."quotes" q
      LEFT JOIN public."users" u
        ON u.id = q.sales_rep_id
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
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", message: "Login required." },
        { status: 401 },
      );
    }

    // Only internal roles can create quotes here.
    const canCreate = isRoleAllowed(user, ["admin", "cs", "sales"]);
    if (!canCreate) {
      return NextResponse.json(
        { ok: false, error: "forbidden", message: "Not allowed." },
        { status: 403 },
      );
    }

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
    // 3) Else, if the caller is SALES, default to their own user.id.
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
    } else {
      // Default assignment for SALES creators.
      const role = (user.role || "").toLowerCase();
      if (role === "sales") {
        salesRepId = Number(user.id);
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
                locked,
                geometry_hash,
                locked_at,
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
