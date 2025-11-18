// app/lib/memory.ts
// Durable per-thread memory for AI orchestration.
// Uses Upstash Redis REST (simple /set & /get), falls back to in-process Map.

export type Mem = Record<string, any>;
export type StoreName = "redis" | "memory";

const FALLBACK = new Map<string, Mem>();

// Trim trailing slashes so we can safely append /set/... etc.
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL?.trim()?.replace(/\/+$/, "") || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";

// Default TTL: 14 days, override with ALEXIO_MEM_TTL_DAYS if needed.
const TTL_DAYS = Number(process.env.ALEXIO_MEM_TTL_DAYS ?? 14);
const TTL_SEC = Math.max(1, TTL_DAYS) * 24 * 60 * 60;

export let LAST_STORE: StoreName = "memory";
export let REDIS_LAST_ERROR: string | null = null;

function keyFor(raw: string): string {
  // Single prefix so all Alex-IO keys are grouped together in Redis.
  return `alexio:mem:${raw}`;
}

function useRedis(): boolean {
  return !!(REDIS_URL && REDIS_TOKEN);
}

/**
 * Low-level helper to call Upstash REST.
 * We avoid /pipeline and just use simple command paths like:
 *   GET  {URL}/get/key
 *   GET  {URL}/set/key/value/EX/60
 */
async function redisCommand(parts: string[]): Promise<any> {
  if (!useRedis()) {
    throw new Error("redis_not_configured");
  }

  const path = parts.map((p) => encodeURIComponent(p)).join("/");
  const url = `${REDIS_URL}/${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
    },
  });

  const json = (await res.json().catch(() => ({}))) as any;

  if (!res.ok || (json && typeof json === "object" && json.error)) {
    const msg =
      json?.error || `redis_http_${res.status}_${res.statusText || ""}`;
    throw new Error(msg);
  }

  return json;
}

async function redisSet(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  const parts = ["set", key, value];
  if (ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    parts.push("EX", String(Math.floor(ttlSeconds)));
  }
  await redisCommand(parts);
}

async function redisGet(key: string): Promise<string | null> {
  const out = await redisCommand(["get", key]);
  if (!out || typeof out !== "object") return null;
  return typeof out.result === "string" ? out.result : null;
}

/* ============================================================
   Public API: loadFacts / saveFacts
   ============================================================ */

export async function loadFacts(id: string): Promise<Mem> {
  const k = keyFor(id);

  if (!useRedis()) {
    // Fallback in-process map (per instance)
    const got = FALLBACK.get(k);
    LAST_STORE = "memory";
    return got ? { ...got } : {};
  }

  try {
    const raw = await redisGet(k);
    if (!raw) {
      LAST_STORE = "redis";
      return {};
    }
    const parsed = JSON.parse(raw);
    LAST_STORE = "redis";
    REDIS_LAST_ERROR = null;
    return (parsed && typeof parsed === "object" ? parsed : {}) as Mem;
  } catch (e: any) {
    // Any error -> drop to in-memory fallback for safety.
    LAST_STORE = "memory";
    REDIS_LAST_ERROR = String(e?.message || e);
    const got = FALLBACK.get(k);
    return got ? { ...got } : {};
  }
}

export async function saveFacts(id: string, facts: Mem): Promise<void> {
  const k = keyFor(id);
  const clean: Mem = facts && typeof facts === "object" ? { ...facts } : {};

  // Always update fallback map so we at least have per-instance memory.
  FALLBACK.set(k, clean);

  if (!useRedis()) {
    LAST_STORE = "memory";
    return;
  }

  try {
    const payload = JSON.stringify(clean);
    await redisSet(k, payload, TTL_SEC);
    LAST_STORE = "redis";
    REDIS_LAST_ERROR = null;
  } catch (e: any) {
    LAST_STORE = "memory";
    REDIS_LAST_ERROR = String(e?.message || e);
  }
}

/* ============================================================
   Self-test for admin endpoint
   ============================================================ */

export async function memSelfTest(): Promise<{
  ok: boolean;
  env: { url: boolean; token: boolean };
  store: StoreName;
}> {
  const envFlags = {
    url: !!REDIS_URL,
    token: !!REDIS_TOKEN,
  };

  if (!useRedis()) {
    LAST_STORE = "memory";
    return { ok: false, env: envFlags, store: LAST_STORE };
  }

  const testKey = keyFor("redis-check-NEW");

  try {
    await redisSet(testKey, "1", 60);
    const got = await redisGet(testKey);
    const ok = got === "1";
    LAST_STORE = ok ? "redis" : "memory";
    REDIS_LAST_ERROR = ok ? null : "set/get mismatch";
    return { ok, env: envFlags, store: LAST_STORE };
  } catch (e: any) {
    LAST_STORE = "memory";
    REDIS_LAST_ERROR = String(e?.message || e);
    return { ok: false, env: envFlags, store: LAST_STORE };
  }
}
