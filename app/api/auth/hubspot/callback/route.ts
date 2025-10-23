// app/api/auth/hubspot/callback/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Helper: read cookie by name from Request
 */
function getCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
}

/**
 * Optional: Upstash Redis saver (no-op if envs are missing)
 */
async function saveTokensIfPossible(tokens: any) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { persisted: false, reason: "No Upstash env" };

  // Minimal REST call (no external SDK needed)
  const key = `hubspot:tokens`;
  const body = JSON.stringify({
    // EVAL "SET" pattern via REST pipeline style:
    // But simplest is /set/<key>/<value>
  });

  // Upstash has simple endpoints: POST { "SET", key, value }
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // pipeline: [["SET", key, JSON.stringify(tokens)]]
      // Newer REST API shape:
      // docs: https://docs.upstash.com/redis/features/restapi
      // To avoid compatibility mismatches, use /set route:
    }),
  }).catch(() => null);

  // Safer (and universally supported): use /set URL form
  // If the POST above didn't run (or fails), we fallback here:
  try {
    const setUrl = new URL(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(tokens))}`);
    const r = await fetch(setUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json();
    return { persisted: j?.result === "OK" };
  } catch {
    return { persisted: false, reason: "REST write failed" };
  }
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCode(code: string, redirectUri: string) {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { ok: false, status: 500, error: "Missing HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET" as const };
  }

  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("redirect_uri", redirectUri);
  params.set("code", code);

  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: `HubSpot token exchange failed: ${text}` as const };
  }

  const json = await resp.json();
  return { ok: true, status: 200, data: json as any };
}

/**
 * GET /api/auth/hubspot/callback
 * - Verifies state (cookie vs query)
 * - Exchanges code for tokens
 * - Optionally persists to Upstash
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const cookieState = getCookie(req, "hs_oauth_state");
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;

  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "Missing code/state" }, { status: 400 });
  }
  if (!cookieState || cookieState !== state) {
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
  }
  if (!redirectUri) {
    return NextResponse.json({ ok: false, error: "Missing HUBSPOT_REDIRECT_URI" }, { status: 500 });
  }

  const result = await exchangeCode(code, redirectUri);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const tokens = result.data; // { access_token, refresh_token, expires_in, ... }
  const persist = await saveTokensIfPossible(tokens);

  // Clear the state cookie
  const res = NextResponse.json({
    ok: true,
    authorized: true,
    hubspot: {
      hasAccessToken: Boolean(tokens?.access_token),
      hasRefreshToken: Boolean(tokens?.refresh_token),
      expiresIn: tokens?.expires_in ?? null,
      persisted: persist?.persisted ?? false,
    }
  });
  res.cookies.set("hs_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
