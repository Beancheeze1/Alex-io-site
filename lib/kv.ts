// lib/kv.ts
const _legacyDefault: null = null;
export default _legacyDefault;

type PingResult = { ok: boolean; provider: "upstash" | "memory" | "none"; roundtripMs?: number; error?: string; };

let _kv: any | null = null;
let _provider: "upstash" | "memory" | "none" = "none";

async function getClient(): Promise<any | null> {
  if (_kv !== null) return _kv;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const { Redis } = await import("@upstash/redis");
      _kv = new Redis({ url, token }); _provider = "upstash"; return _kv;
    } catch {}
  }
  const mem = new Map<string, string>();
  _kv = { async set(k: string, v: string) { mem.set(k, v); return "OK"; },
          async get(k: string) { return mem.get(k) ?? null; },
          async del(k: string) { mem.delete(k); return 1; } };
  _provider = url && token ? "none" : "memory";
  return _kv;
}
function nowMs() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }

export async function kvPing(): Promise<PingResult> {
  try {
    const kv = await getClient(); if (!kv) return { ok: false, provider: "none", error: "No KV provider" };
    const key = `alexio:kvping:${Math.random().toString(36).slice(2)}`;
    const val = `pong:${Date.now()}`; const t0 = nowMs();
    await kv.set(key, val, { ex: 10 }); const got = await kv.get(key); await kv.del(key);
    return { ok: got === val || typeof got === "string", provider: _provider, roundtripMs: Math.round(nowMs() - t0) };
  } catch (e: any) { return { ok: false, provider: _provider, error: e?.message || String(e) }; }
}
