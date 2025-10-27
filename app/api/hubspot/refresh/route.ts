// app/api/hubspot/refresh/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Returns a fresh HubSpot access_token (JSON).
 * Priority:
 *  1) If HUBSPOT_ACCESS_TOKEN is set (dev), return it.
 *  2) If HUBSPOT_REFRESH_TOKEN + CLIENT creds exist, refresh via HubSpot OAuth.
 *  3) If Upstash KV has a refresh token (hs:refresh_token), use that.
 *
 * Env required for refresh:
 *  - HUBSPOT_CLIENT_ID
 *  - HUBSPOT_CLIENT_SECRET
 *  - HUBSPOT_REFRESH_TOKEN   (or KV key hs:refresh_token)
 */
async function refreshFromHubSpot({
  clientId,
  clientSecret,
  refreshToken,
}: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HubSpot token endpoint did not return JSON: ${res.status} ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`HubSpot refresh failed ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!json.access_token) {
    throw new Error(`HubSpot refresh response missing access_token: ${text.slice(0, 300)}`);
  }
  return json;
}

async function getKvRefreshToken(): Promise<string | null> {
  try {
    // Optional KV fallback if you have lib/kv.js (JS) or lib/kv.ts (TS)
    // Import dynamically to avoid build errors if missing.
    const mod = await import("@/lib/kv").catch(() => null as any);
    if (!mod?.kv && !mod?.default) return null;
    const kv: any = mod.kv ?? mod.default;
    const token = await kv.get("hs:refresh_token");
    return (typeof token === "string" && token.length > 0) ? token : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // 1) Dev override: explicit token present
    if (process.env.HUBSPOT_ACCESS_TOKEN) {
      return NextResponse.json({ ok: true, source: "env:access_token", access_token: process.env.HUBSPOT_ACCESS_TOKEN });
    }

    // 2) Gather creds
    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

    // Find a refresh token: ENV first, then KV
    let refreshToken = process.env.HUBSPOT_REFRESH_TOKEN || "";
    if (!refreshToken) {
      const kvToken = await getKvRefreshToken();
      if (kvToken) refreshToken = kvToken;
    }

    if (!clientId || !clientSecret || !refreshToken) {
      const missing = [
        !clientId ? "HUBSPOT_CLIENT_ID" : null,
        !clientSecret ? "HUBSPOT_CLIENT_SECRET" : null,
        !refreshToken ? "HUBSPOT_REFRESH_TOKEN (or KV hs:refresh_token)" : null,
      ].filter(Boolean);
      return NextResponse.json(
        { ok: false, error: "missing_credentials", missing },
        { status: 400 }
      );
    }

    const json = await refreshFromHubSpot({ clientId, clientSecret, refreshToken });

    // Optionally persist new refresh_token if HubSpot rotated it
    if (json.refresh_token && json.refresh_token !== refreshToken) {
      try {
        const mod = await import("@/lib/kv").catch(() => null as any);
        const kv: any = mod?.kv ?? mod?.default;
        if (kv?.set) await kv.set("hs:refresh_token", json.refresh_token);
      } catch {
        // ignore persistence failures
      }
    }

    return NextResponse.json({
      ok: true,
      source: "hubspot_refresh",
      access_token: json.access_token,
      expires_in: json.expires_in ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
