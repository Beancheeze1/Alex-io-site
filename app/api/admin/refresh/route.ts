// app/api/admin/refresh/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Refresh HubSpot access token using the stored refresh token.
 *
 * Reads:
 *   - Upstash Redis key: hubspot:refresh_token
 *
 * Writes (via /pipeline):
 *   - SETEX hubspot:access_token   <ttl> <new_access>
 *   - SET   hubspot:token:access         <new_access>  (legacy/alt)
 *   - SET   hubspot:refresh_token        <new_refresh> (only if HubSpot rotated it)
 *
 * Returns JSON with ok, expiresIn, hubId, and which keys were written.
 *
 * Required env:
 *   HUBSPOT_CLIENT_ID
 *   HUBSPOT_CLIENT_SECRET
 *   (HUBSPOT_REDIRECT_URI not required for refresh grant)
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

async function upstashGet(key: string) {
  const { url, token } = redisEnv();
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashPipeline(cmds: any[]) {
  const { url, token } = redisEnv();
  if (!url || !token) return { ok: false };
  const r = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  return { ok: r.ok, status: r.status };
}

export async function GET() {
  // 1) Load refresh token from Redis
  const refresh = await upstashGet("hubspot:refresh_token");
  if (!refresh) {
    return NextResponse.json(
      {
        ok: false,
        stage: "read-refresh",
        error: "No refresh token in Redis (hubspot:refresh_token). Re-auth first.",
      },
      { status: 200 }
    );
  }

  // 2) Call HubSpot token endpoint (refresh grant)
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.HUBSPOT_CLIENT_ID ?? "",
    client_secret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
    refresh_token: refresh,
  });

  if (!form.get("client_id") || !form.get("client_secret")) {
    return NextResponse.json(
      {
        ok: false,
        stage: "env",
        error: "Missing HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET.",
      },
      { status: 200 }
    );
  }

  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });

  const text = await resp.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* leave as text if not JSON */ }

  if (!resp.ok || !data?.access_token) {
    return NextResponse.json(
      { ok: false, stage: "refresh", status: resp.status, error: data ?? text },
      { status: 200 }
    );
  }

  const access = data.access_token as string;
  const newRefresh = (data.refresh_token as string | undefined) || undefined;
  const expiresIn = Number(data.expires_in ?? 1800) || 1800;

  // 3) Write new tokens to Redis (TTL with small buffer)
  const ttl = Math.max(60, expiresIn - 60); // avoid cutting it too close
  const cmds: any[] = [
    ["SETEX", "hubspot:access_token", String(ttl), access],
    ["SET",   "hubspot:token:access", access], // legacy/alt key for older tools
  ];
  if (newRefresh) cmds.push(["SET", "hubspot:refresh_token", newRefresh]);

  const wrote = await upstashPipeline(cmds);

  // 4) (Optional) Introspect new access to report hubId
  let hubId: number | null = null;
  try {
    const check = await fetch(
      `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(access)}`,
      { cache: "no-store" }
    );
    const infoTxt = await check.text();
    const info = JSON.parse(infoTxt);
    hubId = info?.hub_id ?? info?.hubId ?? null;
  } catch { /* ignore */ }

  return NextResponse.json(
    {
      ok: true,
      stage: "done",
      wrote: wrote.ok,
      expiresIn,
      hubId,
      rotatedRefresh: !!newRefresh,
    },
    { status: 200 }
  );
}
