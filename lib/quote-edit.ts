// lib/quote-edit.ts
//
// Step 21: who may CHANGE a quote (the quote number alone only lets you view it).
//   - Internal server-to-server calls.
//   - Staff (admin / cs / sales) of the quote's shop, or the platform owner.
//   - A buyer whose browser holds the quote's edit grant: the cookie
//     "alexio_qedit", set when they open the edit link from the quote email
//     (/api/quote/open), start the quote themselves, or look it up with
//     quote number + email. The cookie keeps the last 20 quotes.
//   - Demo quotes (Q-D- / Q-DEMO-): anyone.
// Released (locked) quotes: buyers are refused; staff rules stay per route.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { isInternalCall } from "@/lib/internal-call";
import { isDemoQuoteNo } from "@/lib/quote-no";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { editTokenFor, isValidEditToken, normQuoteNo } from "@/lib/quote-edit-token";

export const EDIT_COOKIE = "alexio_qedit";
const MAX_GRANTS = 20;
const GRANT_MAX_AGE_S = 120 * 24 * 60 * 60;

export const EDIT_LINK_REQUIRED = "EDIT_LINK_REQUIRED";
export const EDIT_LINK_MESSAGE =
  "To change this quote, open it from the link in your quote email. With just the quote number you can view it but not change it.";

function readGrants(req: NextRequest): Array<[string, string]> {
  const raw = req.cookies.get(EDIT_COOKIE)?.value || "";
  const out: Array<[string, string]> = [];
  for (const part of raw.split(".")) {
    const i = part.indexOf("~");
    if (i <= 0) continue;
    out.push([normQuoteNo(part.slice(0, i)), part.slice(i + 1)]);
  }
  return out;
}

/** True when this browser holds a valid edit grant for the quote. */
export function hasEditGrant(req: NextRequest, quoteNo: string | null | undefined): boolean {
  const q = normQuoteNo(quoteNo);
  if (!q) return false;
  return readGrants(req).some(([n, t]) => n === q && isValidEditToken(n, t));
}

/** A buyer may edit: demo quote or a valid edit grant. (Staff are checked separately.) */
export function buyerMayEdit(req: NextRequest, quoteNo: string | null | undefined): boolean {
  return isDemoQuoteNo(quoteNo) || hasEditGrant(req, quoteNo);
}

/** Adds the quote's edit grant to the response's cookie (keeps the 20 most recent). */
export function addEditGrant(res: NextResponse, req: NextRequest, quoteNo: string | null | undefined): NextResponse {
  const q = normQuoteNo(quoteNo);
  if (!q) return res;
  let token: string;
  try {
    token = editTokenFor(q);
  } catch (e) {
    console.error("[quote-edit] can't sign edit grant:", e);
    return res;
  }
  const kept = readGrants(req).filter(([n, t]) => n !== q && isValidEditToken(n, t));
  kept.push([q, token]);
  const value = kept
    .slice(-MAX_GRANTS)
    .map(([n, t]) => `${n}~${t}`)
    .join(".");
  res.cookies.set(EDIT_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GRANT_MAX_AGE_S,
  });
  return res;
}

/** Staff (admin / cs / sales) of the quote's shop, or the platform owner. */
export async function isQuoteStaff(req: NextRequest, tenantId: number | string | null | undefined): Promise<boolean> {
  try {
    const user = await getCurrentUserFromRequest(req);
    return (
      !!user &&
      isRoleAllowed(user, ["admin", "cs", "sales"]) &&
      (Number(user.tenant_id) === Number(tenantId) || isPlatformOwner(user))
    );
  } catch {
    return false;
  }
}

export function editLinkRequired(): NextResponse {
  return NextResponse.json(
    { ok: false, error: EDIT_LINK_REQUIRED, message: EDIT_LINK_MESSAGE },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Shared guard for routes that change a saved quote.
 * Internal calls and staff always pass (released quotes included).
 * Everyone else: optional rate limit, then an edit grant (or demo quote),
 * then refused on a released (locked) quote.
 * Returns a response to send back, or null when the change may go ahead.
 */
export async function buyerEditGuard(
  req: NextRequest,
  quote: { quote_no: string; tenant_id: number | string | null; locked?: boolean | null },
  opts: { rateName?: string; perMin?: number; lockedMessage?: string } = {},
): Promise<NextResponse | null> {
  if (isInternalCall(req)) return null;
  if (await isQuoteStaff(req, quote.tenant_id)) return null;

  if (opts.rateName) {
    const rate = await rateLimit(req, opts.perMin ?? 30, opts.rateName);
    if (!rate.success) return rateLimitResponse(rate.reset);
  }

  if (!buyerMayEdit(req, quote.quote_no)) return editLinkRequired();

  if (quote.locked) {
    return NextResponse.json(
      {
        ok: false,
        error: "QUOTE_LOCKED",
        message: opts.lockedMessage || "This quote has been released. Contact the shop to change it.",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}
