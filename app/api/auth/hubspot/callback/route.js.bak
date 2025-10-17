// app/api/auth/hubspot/callback/route.js
import { NextResponse } from "next/server";
import { saveToken, setPortal } from "@lib/oauthStore.js";

export const runtime = "nodejs";

/**
 * HubSpot OAuth callback:
 * 1) Read ?code
 * 2) Exchange for tokens
 * 3) Look up hub (portal) info from access token
 * 4) Save tokens keyed by hubId
 * 5) Return JSON (not a 500) on success or error, so we can see what's wrong
 */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return NextResponse.json({ ok: false, error: "Missing ?code" }, { status: 400 });
    }

    // 2) Exchange code for access/refresh
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
      code,
    });

    const tokenResp = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    const tokenJson = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok) {
      console.error("token exchange failed", tokenJson);
      return NextResponse.json(
        { ok: false, step: "token", error: "Token exchange failed", detail: tokenJson },
        { status: 502 }
      );
    }

    const access_token = tokenJson.access_token;

    // 3) Get hub info from the access token (hubId/portalId + scopes)
    const infoResp = await fetch(
      `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(access_token)}`
    );
    const infoJson = await infoResp.json().catch(() => ({}));
    if (!infoResp.ok) {
      console.error("access-tokens lookup failed", infoJson);
      return NextResponse.json(
        { ok: false, step: "access-tokens", error: "Token info lookup failed", detail: infoJson },
        { status: 502 }
      );
    }

    // HubSpot returns e.g. { hub_id, hub_domain, user, scopes:[...] }
    const hubId = infoJson.hub_id || infoJson.hubId || infoJson.portalId;
    if (!hubId) {
      return NextResponse.json(
        { ok: false, step: "identify", error: "Could not determine hubId from token info", detail: infoJson },
        { status: 502 }
      );
    }

    // include scopes in what we save (handy for debugging)
    tokenJson.scopes = infoJson.scopes || [];

    // 4) Save & remember hub
    saveToken(hubId, tokenJson);
    setPortal(hubId);

    // 5) Return a clear JSON response (keep this while debugging)
    return NextResponse.json({
      ok: true,
      hubId,
      hubDomain: infoJson.hub_domain,
      user: infoJson.user,
      scopes: infoJson.scopes || [],
    });
  } catch (err) {
    console.error("callback error:", err);
    return NextResponse.json(
      { ok: false, step: "catch", error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
