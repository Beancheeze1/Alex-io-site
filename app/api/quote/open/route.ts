// app/api/quote/open/route.ts
//
// Step 21: the buyer's edit link.
// GET /api/quote/open?to=/quote|/quote/layout|/sketch-upload&quote_no=Q-…&et=<token>&…
//   - A valid token stores the quote's edit grant in this browser (cookie).
//   - Always redirects to the page (every other param kept, token removed),
//     so a wrong or old token still opens the quote to view.
// Links are built by editLinkUrl() in lib/quote-edit-token.ts.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { addEditGrant } from "@/lib/quote-edit";
import { EDIT_TOKEN_PARAM, OPEN_PAGE_PATHS, isValidEditToken } from "@/lib/quote-edit-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = await rateLimit(req, 30, "quote-open");
  if (!rate.success) return rateLimitResponse(rate.reset);

  const sp = req.nextUrl.searchParams;
  const toRaw = sp.get("to") || "/quote";
  const to = (OPEN_PAGE_PATHS as readonly string[]).includes(toRaw) ? toRaw : "/quote";
  const quoteNo = (sp.get("quote_no") || "").trim();
  const token = sp.get(EDIT_TOKEN_PARAM) || "";

  const rest = new URLSearchParams();
  sp.forEach((v, k) => {
    if (k !== "to" && k !== EDIT_TOKEN_PARAM) rest.append(k, v);
  });
  const qs = rest.toString();

  // Relative Location: the browser stays on the host it came in on (tenant
  // subdomains included), and the cookie below belongs to that host.
  const res = new NextResponse(null, {
    status: 302,
    headers: { Location: qs ? `${to}?${qs}` : to, "Cache-Control": "no-store" },
  });
  if (quoteNo && isValidEditToken(quoteNo, token)) addEditGrant(res, req, quoteNo);
  return res;
}
