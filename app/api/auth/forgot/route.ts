// app/api/auth/forgot/route.ts
//
// Step 36A: "Forgot password?" on the login page.
//   POST { email } -> always the same { ok, message } (emails can't be probed)
// When the email is a user of the shop this host belongs to, they get a
// 1-hour reset link (lib/user-invites.ts). Rate limited per IP.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { resolveTenantFromHost } from "@/lib/tenant";
import { sendAccessEmail } from "@/lib/user-invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENT = "If that email has an account here, we've sent it a link to choose a new password. It works for 1 hour.";

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 5, "forgot-password");
  if (!rate.success) return rateLimitResponse(rate.reset);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || email.length > 200 || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "invalid_email", message: "Enter your email address." }, { status: 400 });
  }
  try {
    const tenant = await resolveTenantFromHost(req.headers.get("host"));
    if (tenant) {
      const user = await one<{ id: number }>(`SELECT id FROM public."users" WHERE lower(email) = $1 AND tenant_id = $2 LIMIT 1`, [email, tenant.id]);
      if (user) await sendAccessEmail({ userId: Number(user.id), tenantId: Number(tenant.id), kind: "reset" });
    }
  } catch (e) {
    console.error("[auth/forgot] failed:", e);
  }
  return NextResponse.json({ ok: true, message: SENT }, { headers: { "Cache-Control": "no-store" } });
}
