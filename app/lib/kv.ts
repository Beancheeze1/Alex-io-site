// app/lib/kv.ts
//
// Minimal KV helper used by pricing/settings.ts.
// Uses Upstash Redis REST endpoints (/get/<key>, /set/<key>/<val>, optional ?EX=ttl).
// Path A: mechanical fix to ensure persistence works with UPSTASH_REDIS_REST_URL format
// already used elsewhere in this repo (see app/lib/memory.ts).

export type Kv = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, val: string, ttlSec?: number) => Promise<boolean>;
};

function trimSlashes(s: string) {
  return (s || "").trim().replace(/\/+$/, "");
}

export function makeKv(): Kv {
  const base = trimSlashes(process.env.UPSTASH_REDIS_REST_URL || "");
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

  if (!base || !token) {
    // no KV configured — return a no-op shim
    return {
      async get() {
        return null;
      },
      async set() {
        return true;
      },
    };
  }

  async function get(key: string): Promise<string | null> {
    const url = `${base}/get/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV GET failed ${res.status}`);
    const j: any = await res.json().catch(() => null);
    // Upstash REST: { result: "value" | null }
    const v = j && typeof j === "object" ? j.result : null;
    return typeof v === "string" ? v : null;
  }

  async function set(key: string, val: string, ttlSec?: number): Promise<boolean> {
    // Upstash REST supports /set/<key>/<val> with optional ?EX=<seconds>
    const ex =
      typeof ttlSec === "number" && Number.isFinite(ttlSec) && ttlSec > 0
        ? `?EX=${encodeURIComponent(String(Math.floor(ttlSec)))}`
        : "";

    const url = `${base}/set/${encodeURIComponent(key)}/${encodeURIComponent(val)}${ex}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV SET failed ${res.status}`);
    const j: any = await res.json().catch(() => null);
    const r = j && typeof j === "object" ? j.result : null;
    return r === "OK" || r === true;
  }

  return { get, set };
}