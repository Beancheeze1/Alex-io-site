// app/api/public/quote-lookup/route.ts
//
// Public "Look up a quote" for tenant pages (/t/[tenant]).
// Returns the quote URL only when quote number AND email both match a quote
// in that tenant. "Not found" and "wrong email" get the same response so the
// endpoint can't be used to discover which quote numbers exist.
// Rate limited per IP (5/min).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE =
  "We couldn't find a quote with that number and email. Check both and try again, or contact us.";

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 5, "quote-lookup");
  if (!rate.success) return rateLimitResponse(rate.reset);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const tenantSlug = typeof body?.tenant === "string" ? body.tenant.trim().toLowerCase() : "";
  const quoteNo = typeof body?.quote_no === "string" ? body.quote_no.trim().toUpperCase() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (
    !/^[a-z0-9-]{1,63}$/.test(tenantSlug) ||
    !quoteNo ||
    quoteNo.length > 60 ||
    email.length > 200 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_input",
        message: "Enter your quote number and the email address the quote was sent to.",
      },
      { status: 400 },
    );
  }

  try {
    const row = await one<{ quote_no: string }>(
      `
      SELECT q.quote_no
      FROM public."quotes" q
      JOIN public.tenants t
        ON t.id = q.tenant_id
       AND t.active = true
      LEFT JOIN public.customers c
        ON c.id = q.customer_id
      WHERE t.slug = $1
        AND upper(q.quote_no) = $2
        AND lower(trim(coalesce(nullif(q.email, ''), c.email, ''))) = $3
      LIMIT 1
      `,
      [tenantSlug, quoteNo, email],
    );

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "not_found", message: NOT_FOUND_MESSAGE },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      url: `/quote?quote_no=${encodeURIComponent(row.quote_no)}`,
    });
  } catch (err: any) {
    console.error("[quote-lookup] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Something went wrong. Please try again or contact us.",
      },
      { status: 500 },
    );
  }
}
