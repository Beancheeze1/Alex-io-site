// lib/kv.js
// Universal KV with 3 backends:
// 1) Redis (REDIS_URL) using node-redis v4
// 2) Upstash REST (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
// 3) In-memory fallback (dev only)

const REDIS_URL = process.env.REDIS_URL;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ---------- In-memory fallback ----------
const mem = (() => {
  const store = new Map(); // key -> { value, exp: ms | null }
  const now = () => Date.now();

  function set(key, value, ttlSec) {
    const exp = ttlSec ? now() + ttlSec * 1000 : null;
    store.set(key, { value, exp });
    return true;
  }

  function get(key) {
    const hit = store.get(key);
    if (!hit) return null;
    if (hit.exp && hit.exp < now()) {
      store.delete(key);
      return null;
    }
    return hit.value;
  }

  function del(key) {
    return store.delete(key);
  }

  function incr(key) {
    const v = Number(get(key) ?? 0) + 1;
    set(key, String(v), null);
    return v;
  }

  async function ping() {
    return "PONG(mem)";
  }

  return { set, get, del, incr, ping, kind: "memory" };
})();

// ---------- Upstash REST backend ----------
function upstash() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;

  async function call(cmd, ...args) {
    const res = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: [cmd, ...args] }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Upstash ${cmd} failed: ${res.status} ${JSON.stringify(data)}`);
    return data.result;
  }

  async function set(key, value, ttlSec) {
    if (ttlSec) {
      return await call("SET", key, value, "EX", String(ttlSec));
    }
    return await call("SET", key, value);
  }

  async function get(key) {
    return await call("GET", key);
  }

  async function del(key) {
    return await call("DEL", key);
  }

  async function incr(key) {
    return await call("INCR", key);
  }

  async function ping() {
    return await call("PING");
  }

  return { set, get, del, incr, ping, kind: "upstash-rest" };
}

// ---------- node-redis backend ----------
let redisClient = null;
async function getRedisClient() {
  if (!REDIS_URL) return null;
  if (redisClient) return redisClient;

  // Lazy import to avoid bundling in edge runtimes
  const { createClient } = await import("redis");
  const client = createClient({ url: REDIS_URL });
  client.on("error", (err) => console.error("Redis Client Error", err));
  await client.connect();
  redisClient = client;
  return redisClient;
}

function redis() {
  if (!REDIS_URL) return null;

  async function set(key, value, ttlSec) {
    const c = await getRedisClient();
    if (ttlSec) {
      return await c.set(key, value, { EX: ttlSec });
    }
    return await c.set(key, value);
  }

  async function get(key) {
    const c = await getRedisClient();
    return await c.get(key);
  }

  async function del(key) {
    const c = await getRedisClient();
    return await c.del(key);
  }

  async function incr(key) {
    const c = await getRedisClient();
    return await c.incr(key);
  }

  async function ping() {
    const c = await getRedisClient();
    return await c.ping();
  }

  return { set, get, del, incr, ping, kind: "redis" };
}

// ---------- choose backend ----------
const backend = redis() || upstash() || mem;
export const KV_KIND = backend.kind;

/** Set a value (stringified) with optional TTL seconds */
export async function kvSet(key, value, ttlSec) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  return await backend.set(key, v, ttlSec);
}

/** Get a value; tries to JSON.parse, falls back to raw string */
export async function kvGet(key) {
  const v = await backend.get(key);
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function kvDel(key) {
  return await backend.del(key);
}

export async function kvIncr(key) {
  return await backend.incr(key);
}

export async function kvPing() {
  return await backend.ping();
}
