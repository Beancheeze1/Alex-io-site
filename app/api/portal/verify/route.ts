// app/api/portal/verify/route.ts
//
// Step 34A: turns a sign-in link into a buyer session.
//   POST { t: token } -> { ok, tenant: slug } and sets the alexio_buyer cookie
// A POST (from the button on /t/[slug]/orders/signin), not the link itself,
// so mail scanners that open links can't use up the one-time token.
// The token must be unused and under LINK_MINUTES old; it's marked used here.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { hashLinkToken, setBuyerSession } from "@/lib/buyer-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 20, "portal-verify");
  if (!rate.success) return rateLimitResponse(rate.reset);

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const token = typeof b?.t === "string" ? b.t.trim() : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    return json({ ok: false, error: "invalid_link", message: "This sign-in link isn't valid. Ask for a new one." }, 400);
  }
  try {
    const row = await one<{ tenant_id: number; email: string; slug: string }>(
      `UPDATE public.buyer_login_links l
          SET used_at = now()
         FROM public.tenants t
        WHERE l.token_hash = $1 AND l.used_at IS NULL AND l.expires_at > now()
          AND t.id = l.tenant_id AND t.active = true
       RETURNING l.tenant_id, l.email, t.slug`,
      [hashLinkToken(token)],
    );
    if (!row) {
      return json({ ok: false, error: "expired_link", message: "This sign-in link has expired or was already used. Ask for a new one." }, 410);
    }
    const res = json({ ok: true, tenant: row.slug });
    return setBuyerSession(res, Number(row.tenant_id), row.email);
  } catch (e) {
    console.error("[portal/verify] failed:", e);
    return json({ ok: false, error: "server_error", message: "Something went wrong. Please try again." }, 500);
  }
}
