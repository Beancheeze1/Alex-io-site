// app/api/portal/request/route.ts
//
// Step 34A: "Email me a sign-in link" for the buyer portal.
//   POST { tenant: slug, email } -> always { ok, message } (the same answer
//   whether or not the email has quotes there, so emails can't be probed).
// A link is only sent when the email has quotes at that shop, at most
// LINKS_PER_WINDOW per email per LINK_WINDOW_MINUTES. Rate limited per IP.
// The link opens /t/[slug]/orders/signin on the shop's own address; only a
// SHA-256 of its token is stored (buyer_login_links, migration 045).

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { sendHtmlEmail } from "@/lib/email/send-html";
import { hashLinkToken, newLinkToken } from "@/lib/buyer-session";
import { shopSender } from "@/app/lib/quote-mail";
import { buyerQuoteCount, portalTenant } from "@/app/lib/portal";
import { LINKS_PER_WINDOW, LINK_MINUTES, LINK_WINDOW_MINUTES, isPortalEmail, normEmail, signInEmail } from "@/app/lib/portal-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENT = `If that email has quotes or orders with us, we've sent it a sign-in link. It works once, for ${LINK_MINUTES} minutes.`;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 5, "portal-request");
  if (!rate.success) return rateLimitResponse(rate.reset);

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = normEmail(b?.email);
  if (!isPortalEmail(email)) return json({ ok: false, error: "invalid_email", message: "Enter the email address your quotes were sent to." }, 400);
  const tenant = await portalTenant(b?.tenant);
  if (!tenant) return json({ ok: false, error: "not_found", message: "Shop not found." }, 404);

  try {
    if ((await buyerQuoteCount(tenant.id, email)) === 0) return json({ ok: true, message: SENT });

    const recent = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.buyer_login_links
        WHERE tenant_id = $1 AND lower(email) = $2 AND created_at > now() - ($3::int * interval '1 minute')`,
      [tenant.id, email, LINK_WINDOW_MINUTES],
    );
    if ((Number(recent?.n) || 0) >= LINKS_PER_WINDOW) return json({ ok: true, message: SENT });

    const token = newLinkToken();
    const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "").trim().slice(0, 64) || null;
    await q(
      `INSERT INTO public.buyer_login_links (tenant_id, email, token_hash, expires_at, ip)
       VALUES ($1, $2, $3, now() + ($4::int * interval '1 minute'), $5)`,
      [tenant.id, email, hashLinkToken(token), LINK_MINUTES, ip],
    );

    const sender = await shopSender(tenant.id);
    const link = `${sender.baseUrl}/t/${encodeURIComponent(tenant.slug)}/orders/signin?t=${encodeURIComponent(token)}`;
    const { subject, html } = signInEmail({
      brand: sender.brand,
      link,
      minutes: LINK_MINUTES,
      primaryColor: sender.primaryColor,
      onPrimary: sender.onPrimary,
      logoUrl: sender.logoUrl,
    });
    const r = await sendHtmlEmail({ to: email, subject, html, replyTo: sender.replyTo, replyToName: sender.brand, fromName: sender.brand });
    if (!r.ok) console.error("[portal/request] send failed", { tenant: tenant.slug, err: r.error });
    return json({ ok: true, message: SENT });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01") return json({ ok: false, error: "not_migrated", message: "Order sign-in isn't set up yet." }, 503);
    console.error("[portal/request] failed:", e);
    return json({ ok: false, error: "server_error", message: "Something went wrong. Please try again." }, 500);
  }
}
