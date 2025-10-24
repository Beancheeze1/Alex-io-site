// app/api/auth/hubspot/callback/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * HubSpot OAuth callback
 * - Exchanges ?code for access/refresh tokens
 * - Persists tokens to Upstash Redis via REST
 *   • Canonical:   hubspot:access_token    (SETEX with TTL)
 *   • Canonical:   hubspot:refresh_token   (SET, no TTL)
 *   • Legacy/alt:  hubspot:token:access    (SET, no TTL)  // keeps older tools happy
 * - Returns a small JSON status payload for quick confirmation
 *
 * Required env:
 *   HUBSPOT_CLIENT_ID
 *   HUBSPOT_CLIENT_SECRET
 *   HUBSPOT_REDIRECT_URI               (must match HubSpot app setting)
 *   UPSTASH_REDIS_REST_URL   or REDIS_URL
 *   UPSTASH_REDIS_REST_TOKEN or REDIS_TOKEN
 */

function redisEnv() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.REDIS_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN ?? "";
  return { url, token };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err  = url.searchParams.get("error");
  const state = url.searchParams.get("state") ?? undefined;

  // 0) Early errors (HubSpot sent an error)
  if (err) {
    return NextResponse.json(
      { ok: false, stage: "callback", error: err, state },
      { status: 200 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { ok: false, stage: "callback", error: "Missing OAuth code", state },
      { status: 200 }
    );
  }

  // 1) Exchange code -> tokens
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.HUBSPOT_CLIENT_ID ?? "",
    client_secret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
    redirect_uri: process.env.HUBSPOT_REDIRECT_URI ?? "",
    code,
  });

  if (!body.get("client_id") || !body.get("client_secret") || !body.get("redirect_uri")) {
    return NextResponse.json(
      {
        ok: false,
        stage: "env",
        error: "Missing HUBSPOT_CLIENT_ID/SECRET or HUBSPOT_REDIRECT_URI in environment.",
      },
      { status: 200 }
    );
  }

  const tokenResp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  const tokenText = await tokenResp.text();
  let tokenData: any = null;
  try { tokenData = JSON.parse(tokenText); } catch { /* keep as text */ }

  if (!tokenResp.ok) {
    return NextResponse.json(
      { ok: false, stage: "token", status: tokenResp.status, error: tokenData ?? tokenText },
      { status: 200 }
    );
  }

  const access  = tokenData?.access_token as string | undefined;
  const refresh = tokenData?.refresh_token as string | undefined;
  const expiresIn = Number(tokenData?.expires_in ?? 0) || undefined;

  // 2) Persist to Upstash Redis (REST)
  const { url: restUrl, token: restToken } = redisEnv();
  let persisted = false;
  let keysWritten: Record<string, boolean> = {};

  if (restUrl && restToken && access && refresh) {
    // TTL buffer so we don't serve an about-to-expire token
    const ttl = Math.max(60, (expiresIn ?? 1800) - 60);

    // Prefer the /pipeline REST endpoint for multi-writes
    // Writes:
    //   - SETEX hubspot:access_token <ttl> <access>
    //   - SET   hubspot:refresh_token <refresh>
    //   - SET   hubspot:token:access  <access>   (legacy/alt key for older tools)
    const pipelineCmds = JSON.stringify([
      ["SETEX", "hubspot:access_token", String(ttl), access],
      ["SET",   "hubspot:refresh_token", refresh],
      ["SET",   "hubspot:token:access",  access],
    ]);

    const r = await fetch(`${restUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${restToken}`,
        "Content-Type": "application/json",
      },
      body: pipelineCmds,
      cache: "no-store",
    });

    persisted = r.ok;

    // Best-effort probe of keys we just wrote (optional)
    try {
      const checkAccess = await fetch(`${restUrl}/get/hubspot:access_token`, {
        headers: { Authorization: `Bearer ${restToken}` },
        cache: "no-store",
      }).then(x => x.json()).catch(() => null);

      const checkRefresh = await fetch(`${restUrl}/get/hubspot:refresh_token`, {
        headers: { Authorization: `Bearer ${restToken}` },
        cache: "no-store",
      }).then(x => x.json()).catch(() => null);

      const checkLegacy = await fetch(`${restUrl}/get/hubspot:token:access`, {
        headers: { Authorization: `Bearer ${restToken}` },
        cache: "no-store",
      }).then(x => x.json()).catch(() => null);

      keysWritten = {
        "hubspot:access_token":  !!checkAccess?.result,
        "hubspot:refresh_token": !!checkRefresh?.result,
        "hubspot:token:access":  !!checkLegacy?.result,
      };
    } catch {
      // ignore probe errors
    }
  }

  return NextResponse.json({
    ok: true,
    authorized: true,
    state,
    hubspot: {
      hasAccessToken: !!access,
      hasRefreshToken: !!refresh,
      expiresIn,
      persisted,
      keys: keysWritten,
    },
  });
}
