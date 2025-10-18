// lib/kv.js
/**
 * Minimal KV wrapper that prefers Upstash REST if configured,
 * and falls back to an in-memory Map (per process) otherwise.
 * No 'redis' NPM package required.
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

const mem = new Map();

/** simple TTL helper */
function nowSec() { return Math.floor(Date.now() / 1000); }

export async function kvGet(key) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.result ?? null;
  }
  const rec = mem.get(key);
  if (!rec) return null;
  if (rec.exp && rec.exp < nowSec()) {
    mem.delete(key);
    return null;
  }
  return rec.val ?? null;
}

export async function kvSet(key, val, ttlSec) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const body = { value: val };
    const r = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ttlSec ? { ...body, ex: ttlSec } : body),
    });
    return r.ok;
  }
  mem.set(key, { val, exp: ttlSec ? nowSec() + ttlSec : null });
  return true;
}

export async function kvDel(key) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    return true;
  }
  mem.delete(key);
  return true;
}

/**
 * NEW: kvPing — tiny health check some admin routes import.
 * Tries a set→get→del round-trip. Returns a result object.
 */
export async function kvPing() {
  const engine = (UPSTASH_URL && UPSTASH_TOKEN) ? "upstash" : "memory";
  const key = `ping:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const value = "ok";
  const wrote = await kvSet(key, value, 10);
  const read = wrote ? await kvGet(key) : null;
  await kvDel(key);
  return { ok: wrote && read === value, engine };
}
