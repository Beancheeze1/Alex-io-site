
// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";
import { kvPing } from "@/lib/kv";
import { tokenStore } from "@/lib/tokenStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Tiny Upstash REST helper (no new deps; safe if envs are missing)
async function kvHas(key: string): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      // Avoid caching at edge/CDN layers
      cache: "no-store",
    });
    if (!res.ok) return false;
    // Upstash REST returns: { "result": string | null }
    const data = await res.json().catch(() => null) as { result?: unknown } | null;
    return data != null && (data as any).result != null;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    // 1) Check KV (primary, since your callback persisted KV keys)
    const kvAccessCandidates = [
      "hubspot:access_token",
      "hubspot:token:access",   // seen in your callback readout
    ];
    const kvRefreshCandidates = ["hubspot:refresh_token"];

    const kvAccess = await (async () => {
      for (const k of kvAccessCandidates) if (await kvHas(k)) return true;
      return false;
    })();

    const kvRefresh = await (async () => {
      for (const k of kvRefreshCandidates) if (await kvHas(k)) return true;
      return false;
    })();

    // 2) Fallback to local tokenStore (file-based) if KV not present
    let fsAccess = false, fsRefresh = false, portal: number | undefined;
    try {
      const keys = tokenStore.listKeys(); // string[]
      fsAccess = fsAccess || keys.includes("hubspot:access_token") || keys.includes("hubspot:token:access");
      fsRefresh = fsRefresh || keys.includes("hubspot:refresh_token");

      // optional: also check first numeric portal bucket if present
      const maybePortal = keys.find(k => /^\d+$/.test(k));
      if (maybePortal) {
        portal = Number(maybePortal);
        const rec = tokenStore.get(portal);
        fsAccess = fsAccess || !!rec?.access_token;
        fsRefresh = fsRefresh || !!rec?.refresh_token;
      }
    } catch {
      // ignore file-store errors; KV already covered
    }

    const access = kvAccess || fsAccess;
    const refresh = kvRefresh || fsRefresh;

    // 3) KV ping details for visibility
    const kv = await kvPing();

    return NextResponse.json({
      ok: true,
      authorized: access && refresh,
      tokens: {
        access,
        refresh,
        sources: {
          kv: { access: kvAccess, refresh: kvRefresh },
          filestore: { access: fsAccess, refresh: fsRefresh, portal },
        },
      },
      kv,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
