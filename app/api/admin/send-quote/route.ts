// app/api/admin/send-quote/route.ts
//
// Admin-only: builds and sends the customer quote email.
// Step 37J: the email itself is built and sent by app/lib/send-quote-email.ts
// (shared with the automatic email for a buyer's new boxes-only quote).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { sendQuoteEmail } from "@/app/lib/send-quote-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type In = {
  quoteNo: string;
  to?: string;
  subject?: string;
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin", "cs", "sales"]))
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  let body: In;
  try { body = (await req.json()) as In; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const quoteNo = typeof body.quoteNo === "string" ? body.quoteNo.trim() : "";
  if (!quoteNo) return NextResponse.json({ ok: false, error: "missing_quoteNo" }, { status: 400 });

  const r = await sendQuoteEmail({
    quoteNo,
    tenantId: Number(user.tenant_id),
    to: body.to,
    subject: body.subject,
    by: String((user as { name?: string | null }).name || user.email || "staff"),
  });
  if (r.ok) return NextResponse.json(r);
  const { status, ...rest } = r;
  return NextResponse.json(rest, { status });
}
