// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * whoami with auto-refresh:
 * - Reads access token from Redis (canonical key hubspot:access_token; legacy fallback supported)
 * - Introspects at HubSpot: /oauth/v1/access-tokens/:token
 * - On 401/403, refreshes using Redis key hubspot:refresh_token and retries
 *
 * Env:
 *   HUBSPOT_CLIENT_ID
 *   HUBSPOT_CLIENT_SECRET
 *   UPSTASH_REDIS_REST_URL   or REDIS_URL
 *   UPSTASH_REDIS_REST_TOKEN or REDIS_TOKEN
 */

function upstashEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.REDIS_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN ?? "";
  return { url, token };
}

async function upstashGet(key: string): Promise<string | null> {
  const { url, token } = upstashEnv();
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const val = j?.result;
  return typeof val === "string" && val.length > 0 ? val : null;
}

async function upstashPipeline(cmds: any[]) {
  const { url, token } = upstashEnv();
  if (!url || !token) return { ok: false, status: 0 };
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

async function resolveAccessToken(): Promise<{ token: string | null; source: string | null }> {
  // 1) Canonical key
  const canonical = await upstashGet("hubspot:access_token");
  if (canonical) return { token: canonical, source: "redis hubspot:access_token" };

  // 2) Legacy/alt key (kept for older tools)
  const legacy = await upstashGet("hubspot:token:access");
  if (legacy) return { token: legacy, source: "redis hubspot:token:access" };

  // 3) Cookie fallback (dev)
  try {
    const jar = await cookies();
    const fromCookie = jar.get("access_token")?.value;
    if (fromCookie) return { token: fromCookie, source: "cookie access_token" };
  } catch { /* ignore */ }

  // 4) Env fallback (last resort)
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    return { token: process.env.HUBSPOT_ACCESS_TOKEN, source: "env HUBSPOT_ACCESS_TOKEN" };
  }
  return { token: null, source: null };
}

async function introspect(token: string) {
  const r = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  const text = await r.text();
  let info: any = null;
  try { info = JSON.parse(text); } catch { info = text; }
  return { ok: r.ok, status: r.status, info };
}

async function tryRefresh() {
  // Read refresh token
  const refresh = await upstashGet("hubspot:refresh_token");
  if (!refresh) return { ok: false, reason: "no-refresh-token" };

  if (!process.env.HUBSPOT_CLIENT_ID || !process.env.HUBSPOT_CLIENT_SECRET) {
    return { ok: false, reason: "missing-client-env" };
  }

  // Request new access (and maybe new refresh)
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
    refresh_token: refresh,
  });

  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });

  const text = await resp.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!resp.ok || !data?.access_token) {
    return { ok: false, reason: "refresh-failed", status: resp.status, data };
  }

  const access = data.access_token as string;
  const newRefresh = (data.refresh_token as string | undefined) || undefined;
  const expiresIn = Number(data.expires_in ?? 1800) || 1800;
  const ttl = Math.max(60, expiresIn - 60);

  // Write tokens back (canonical + legacy + refresh if rotated)
  const cmds: any[] = [
    ["SETEX", "hubspot:access_token", String(ttl), access],
    ["SET",   "hubspot:token:access", access],
  ];
  if (newRefresh) cmds.push(["SET", "hubspot:refresh_token", newRefresh]);
  const wrote = await upstashPipeline(cmds);

  return { ok: wrote.ok, access, newRefresh, expiresIn };
}

export async function GET() {
  // Step 1: resolve current access token
  const { token, source } = await resolveAccessToken();
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        hasToken: false,
        note: "No HubSpot access token found in Redis/cookie/env.",
      },
      { status: 200 }
    );
  }

  // Step 2: introspect
  let first = await introspect(token);
  let refreshed = false;
  let refreshMeta: any = null;

  // Step 3: on 401/403, auto-refresh and retry
  if (!first.ok && (first.status === 401 || first.status === 403)) {
    const r = await tryRefresh();
    refreshMeta = r;
    if (r.ok && r.access) {
      refreshed = true;
      first = await introspect(r.access);
    }
  }

  if (!first.ok) {
    return NextResponse.json(
      {
        ok: false,
        hasToken: true,
        source,
        status: first.status,
        error: first.info,
        refreshed,
        refreshMeta,
      },
      { status: 200 }
    );
  }

  const hubId = first.info?.hub_id ?? first.info?.hubId ?? null;
  return NextResponse.json(
    {
      ok: true,
      hasToken: true,
      source,
      hubId,
      info: first.info,
      refreshed,
      refreshMeta: refreshed ? {
        ok: refreshMeta?.ok ?? true,
        expiresIn: refreshMeta?.expiresIn ?? null,
        rotatedRefresh: !!refreshMeta?.newRefresh,
      } : null,
      t: new Date().toISOString(),
    },
    { status: 200 }
  );
}
