// app/api/admin/quotes/edit-link/route.ts
//
// Step 21: staff copy the buyer's private edit link for a quote (e.g. for a
// quote sent before Step 21, or a buyer who lost the email).
// GET ?quote_no=Q-…  -> { ok, quote_url, layout_url }
// Staff (admin / cs / sales) of the quote's shop, or the platform owner.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { editLinkUrl } from "@/lib/quote-edit-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return json({ ok: false, error: "forbidden" }, 403);

    const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);

    const quote = await one<{ quote_no: string; tenant_id: number }>(
      `SELECT quote_no, tenant_id FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
      return json({ ok: false, error: "not_found", message: "Quote not found." }, 404);
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const qn = encodeURIComponent(quote.quote_no);
    return json({
      ok: true,
      quote_url: editLinkUrl(`${base}/quote?quote_no=${qn}`, quote.quote_no),
      layout_url: editLinkUrl(`${base}/quote/layout?quote_no=${qn}`, quote.quote_no),
    });
  } catch (e) {
    console.error("[admin/quotes/edit-link] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't build the link." }, 500);
  }
}
