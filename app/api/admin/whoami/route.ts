import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Path-A whoami:
 * - Reads HubSpot access token from Upstash Redis key "hubspot:access_token".
 * - Fallbacks: cookie "access_token", then env HUBSPOT_ACCESS_TOKEN.
 * - Introspects via: GET https://api.hubapi.com/oauth/v1/access-tokens/:token
 */

async function getFromRedis(key: string) {
  // Support both UPSTASH_* and REDIS_* env names
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.REDIS_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN ?? "";

  if (!url || !token) return null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // Upstash REST accepts a single command as ["GET","key"]
      body: JSON.stringify(["GET", key]),
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string | null };
    return (data?.result ?? null) || null;
  } catch {
    return null;
  }
}

async function resolveAccessToken(): Promise<string | null> {
  // 1) Redis (preferred)
  const redisToken = await getFromRedis("hubspot:access_token");
  if (redisToken) return redisToken;

  // 2) Cookie (await to satisfy TS where cookies() is Promise-typed)
  try {
    const jar = await cookies();
    const cookieToken = jar.get("access_token")?.value;
    if (cookieToken) return cookieToken;
  } catch {
    // ignore
  }

  // 3) Env fallback
  if (process.env.HUBSPOT_ACCESS_TOKEN) return process.env.HUBSPOT_ACCESS_TOKEN;

  return null;
}

export async function GET() {
  const at = await resolveAccessToken();

  if (!at) {
    return NextResponse.json(
      {
        ok: false,
        hasToken: false,
        note:
          "No HubSpot access token found (checked Upstash key 'hubspot:access_token', cookie 'access_token', and HUBSPOT_ACCESS_TOKEN).",
      },
      { status: 200 }
    );
  }

  try {
    const hs = await fetch(
      `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(at)}`,
      { method: "GET", cache: "no-store" }
    );

    const text = await hs.text();
    let info: any = null;
    try {
      info = JSON.parse(text);
    } catch {
      // leave as text
    }

    if (!hs.ok) {
      return NextResponse.json(
        {
          ok: false,
          hasToken: true,
          status: hs.status,
          statusText: hs.statusText,
          error: typeof info === "object" ? info : text,
        },
        { status: 200 }
      );
    }

    const hubId =
      typeof info === "object" ? info.hub_id ?? info.hubId ?? null : null;

    return NextResponse.json(
      {
        ok: true,
        hasToken: true,
        hubId,
        info,
        t: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, hasToken: true, error: err?.message || String(err) },
      { status: 200 }
    );
  }
}
