// app/api/auth/hubspot/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/hubspot
 * - Generates a CSRF state
 * - Stores it in an HttpOnly cookie
 * - Redirects to HubSpot authorize URL with scopes
 */
export async function GET() {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "Missing HUBSPOT_CLIENT_ID or HUBSPOT_REDIRECT_URI" },
      { status: 500 }
    );
  }

  // 10 min state validity
  const state = crypto.randomUUID();
  const scopes = [
    "oauth", "files",
    "crm.objects.deals.read", "crm.objects.deals.write",
    "crm.objects.contacts.read", "crm.objects.contacts.write",
    "crm.objects.owners.read",
    "crm.objects.companies.read", "crm.objects.companies.write",
    "crm.objects.line_items.read", "crm.objects.line_items.write",
    "crm.objects.quotes.read", "crm.objects.quotes.write",
    "crm.objects.products.read",
    "crm.schemas.contacts.read", "crm.schemas.custom.read",
    "conversations.read", "conversations.write"
  ].join(" ");

  const url = new URL("https://app.hubspot.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString(), { status: 302 });
  res.cookies.set("hs_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });

  return res;
}
