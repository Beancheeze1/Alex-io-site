// app/api/portal/open/route.ts
//
// Step 34A: opens one of the signed-in buyer's quotes from the portal.
//   GET ?quote_no=Q-… -> gives this browser the quote's edit grant (same as
//   the quote email's link) and redirects to /quote?quote_no=…
// Anyone else (no session, or not their quote) is sent to the quote page
// without the grant, which only shows it.

import { NextRequest, NextResponse } from "next/server";
import { readBuyerSession } from "@/lib/buyer-session";
import { addEditGrant } from "@/lib/quote-edit";
import { buyerOwnsQuote } from "@/app/lib/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const quoteNo = String(req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 60);
  // Relative Location: stay on the shop's host, where the cookies live.
  const res = new NextResponse(null, {
    status: 302,
    headers: { Location: `/quote?quote_no=${encodeURIComponent(quoteNo)}`, "Cache-Control": "no-store" },
  });
  if (!quoteNo) return res;
  try {
    const s = readBuyerSession(req);
    if (!s) return res;
    const owned = await buyerOwnsQuote(s.tenantId, s.email, quoteNo);
    if (!owned) return res;
    res.headers.set("Location", `/quote?quote_no=${encodeURIComponent(owned)}`);
    return addEditGrant(res, req, owned);
  } catch (e) {
    console.error("[portal/open] failed:", e);
    return res;
  }
}
