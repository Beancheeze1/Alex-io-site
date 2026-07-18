// app/api/admin/quotes/internal-notes/route.ts
//
// Staff-only read of quotes.internal_notes by quote_no.
//
// Deliberately separate from /api/quote/print: that endpoint's response is
// consumed by the customer-facing print page (QuotePrintClient.tsx) as well
// as the admin detail view, so internal_notes must never be added to it —
// doing so would ship the field to every customer's browser in the network
// response even if the UI never rendered it. This route exists so the admin
// quote detail page can load internal_notes without touching that shared
// endpoint at all.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return json(enforced.body, enforced.status);

  const role = (user?.role || "").toLowerCase();
  const isStaff = role === "admin" || role === "sales" || role === "cs";

  if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
  if (!isStaff)
    return json({ ok: false, error: "FORBIDDEN", message: "Staff access required." }, 403);

  const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim();
  if (!quoteNo) {
    return json({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  }

  const quote = await one<{ internal_notes: string | null }>(
    `select internal_notes from quotes where quote_no = $1 and tenant_id = $2`,
    [quoteNo, user.tenant_id],
  );

  if (!quote) {
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }

  return json({ ok: true, internal_notes: quote.internal_notes ?? null });
}
