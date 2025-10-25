import { NextResponse } from "next/server";
import { tokenStore } from "@/lib/tokenStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function kvGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${tok}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const js = await res.json().catch(() => null) as { result?: string } | null;
  return js?.result ?? null;
}

async function kvSet(key: string, value: string, ttlSeconds?: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return;
  const path = ttlSeconds ? `/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}` 
                          : `/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${tok}` }, method: "POST" });
}

export async function POST(req: Request) {
  // Optional admin key guard
  const adminKey = process.env.ADMIN_KEY || "";
  const hdr = req.headers.get("x-admin-key") || "";
  if (!adminKey || hdr !== adminKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1) Find a refresh token (KV first, then filestore)
    let refresh = await kvGet("hubspot:refresh_token");
    if (!refresh) {
      // try filestore (portal bucket if present)
      const keys = tokenStore.listKeys();
      const maybePortal = keys.find(k => /^\d+$/.test(k));
      if (maybePortal) refresh = tokenStore.get(Number(maybePortal))?.refresh_token ?? null;
    }
    if (!refresh) {
      return NextResponse.json({ ok: false, error: "No refresh token" }, { status: 400 });
    }

    // 2) HubSpot refresh
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.HUBSPOT_CLIENT_ID || "",
      client_secret: process.env.HUBSPOT_CLIENT_SECRET || "",
      refresh_token: refresh,
    });

    const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });

    if (!r.ok) {
      const text = await r.text();
      return NextResponse.json({ ok: false, error: "Refresh failed", detail: text }, { status: 500 });
    }

    const tok = await r.json() as {
      access_token: string; expires_in?: number; refresh_token?: string;
    };

    // 3) Persist new tokens (KV + filestore for compatibility)
    const ttl = typeof tok.expires_in === "number" ? Math.max(60, tok.expires_in - 60) : undefined;
    await kvSet("hubspot:token:access", tok.access_token, ttl);
    await kvSet("hubspot:access_token", tok.access_token, ttl);
    if (tok.refresh_token) {
      await kvSet("hubspot:refresh_token", tok.refresh_token);
    }

    // If you also keep a portal record, update it non-destructively
    try {
      const keys = tokenStore.listKeys();
      const maybePortal = keys.find(k => /^\d+$/.test(k));
      if (maybePortal) {
        const p = Number(maybePortal);
        const rec = tokenStore.get(p) || {};
        tokenStore.set({ ...rec, access_token: tok.access_token, refresh_token: tok.refresh_token ?? rec.refresh_token }, p);
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      refreshed: true,
      expiresIn: tok.expires_in ?? null,
      wrote: { kv: true, filestore: true },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
