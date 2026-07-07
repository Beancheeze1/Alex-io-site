// app/api/quotes/customers/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

// GET /api/quotes/customers
// Deduplicated customer list (name/email/phone) for the rep intake modal's
// customer-name autocomplete. Same auth/tenant scoping as GET /api/quotes.
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req as any);

    // Enforce tenant host -> session tenant match (A2 subdomain multi-tenant)
    const enforced = await enforceTenantMatch(req as any, user);
    if (!enforced.ok) {
      return NextResponse.json(enforced.body, { status: enforced.status });
    }

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

    if (isSales) {
      // Sales can only see customers from their own quotes (AND within their tenant).
      const rows = await q(
        `
        SELECT DISTINCT ON (customer_name)
               customer_name,
               email,
               phone
        FROM public."quotes"
        WHERE tenant_id = $1
          AND sales_rep_id = $2
        ORDER BY customer_name, updated_at DESC
        LIMIT 500
      `,
        [user.tenant_id, user.id],
      );

      const customers = (rows as any[]).map((r) => ({
        name: r.customer_name,
        email: r.email,
        phone: r.phone,
      }));

      return NextResponse.json({ ok: true, customers });
    }

    // Admin + CS: all customers (within tenant)
    const rows = await q(
      `
      SELECT DISTINCT ON (customer_name)
             customer_name,
             email,
             phone
      FROM public."quotes"
      WHERE tenant_id = $1
      ORDER BY customer_name, updated_at DESC
      LIMIT 500
    `,
      [user.tenant_id],
    );

    const customers = (rows as any[]).map((r) => ({
      name: r.customer_name,
      email: r.email,
      phone: r.phone,
    }));

    return NextResponse.json({ ok: true, customers });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
