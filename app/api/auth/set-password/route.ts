// app/api/auth/set-password/route.ts
//
// Step 36A: set a password from an invite or reset link (lib/user-invites.ts).
//   POST { t, password } -> { ok, email } (then the page sends them to /login)
// One use per link; invites last 7 days, resets 1 hour. Rate limited per IP.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { redeemPasswordLink } from "@/lib/user-invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 10, "set-password");
  if (!rate.success) return rateLimitResponse(rate.reset);
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const r = await redeemPasswordLink(typeof b?.t === "string" ? b.t.trim() : "", typeof b?.password === "string" ? b.password : "");
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, message: r.message }, { status: r.status });
    return NextResponse.json({ ok: true, email: r.email }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[auth/set-password] failed:", e);
    return NextResponse.json({ ok: false, error: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
