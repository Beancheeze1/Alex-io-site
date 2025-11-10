// app/lib/memory.ts
// Durable per-thread memory for AI orchestration.
// Uses Upstash Redis REST (no extra dependency). Falls back to in-process Map.

export type Mem = Record<string, any>;

// Exposed for diagnostics
export let LAST_STORE: "redis" | "memory" = "memory";
export let REDIS_LAST_ERROR: string | null = null;

const FALLBACK = new Map<string, Mem>();

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const TTL_DAYS = Number(process.env.ALEXIO_MEM_TTL_DAYS ?? 14); // keep facts for 2 weeks
const TTL_SEC = Math.max(1, TTL_DAYS) * 24 * 60 * 60;

function keyFor(threadId: string | number | null | undefined) {
  const id = (threadId ?? "").toString().trim();
  // Namespace by env to avoid mixing dev/prod
  const env = process.env.NODE_ENV || "production";
  return `alexio:mem:${env}:${id || "no-thread"}`;
}

async function redisFetch(path: string, body?: any) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    LAST_STORE = "memory";
    REDIS_LAST_ERROR = "env_missing";
    return null;
  }
  try {
    const res = await fetch(`${REDIS_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      LAST_STORE = "memory";
      REDIS_LAST_ERROR = `upstash_status_${res.status}`;
      throw new Error(`Upstash error ${res.status}`);
    }
    const j = await res.json().catch(() => ({}));
    LAST_STORE = "redis";
    REDIS_LAST_ERROR = null;
    return j;
  } catch (e: any) {
    LAST_STORE = "memory";
    REDIS_LAST_ERROR = String(e?.message || e || "redis_fetch_error");
    // rethrow so callers can decide to fallback
    throw e;
  }
}

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) {
      out[k] = v;
    }
  }
  return out as T;
}

function shallowMerge(a: Mem, b: Mem): Mem {
  // NOTE: b wins only for keys that exist in b (undefined does NOT erase)
  const bb = compact(b || {});
  return { ...(a || {}), ...bb };
}

export async function loadFacts(threadId: string | number | null | undefined): Promise<Mem> {
  const k = keyFor(threadId);

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      // GET value
      const j = await redisFetch("/get", { key: k });
      // if redisFetch threw, we are already on LAST_STORE="memory"
      const raw = j?.result ?? null;
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === "object") ? (parsed as Mem) : {};
      } catch {
        return {};
      }
    } catch {
      // fall through to Map fallback
    }
  }

  LAST_STORE = "memory";
  return FALLBACK.get(k) || {};
}

export async function saveFacts(threadId: string | number | null | undefined, patch: Mem): Promise<void> {
  const k = keyFor(threadId);

  // Load current, merge, then persist
  const current = await loadFacts(threadId);
  const merged = shallowMerge(current, patch || {});

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await redisFetch("/set", { key: k, value: JSON.stringify(merged), ex: TTL_SEC });
      LAST_STORE = "redis";
      return;
    } catch {
      // fall through to Map fallback
    }
  }

  LAST_STORE = "memory";
  FALLBACK.set(k, merged);
}

// Lightweight self-test for admin route: set/get/delete a temp key.
export async function memSelfTest(): Promise<{
  env: { url: boolean; token: boolean };
  ok: boolean;
  store: "redis" | "memory";
  status?: number;
  error?: string | null;
}> {
  const env = { url: !!REDIS_URL, token: !!REDIS_TOKEN };

  // If env missing, report immediately
  if (!env.url || !env.token) {
    LAST_STORE = "memory";
    return { env, ok: false, store: LAST_STORE, error: "env_missing" };
  }

  const key = `alexio:mem:test:${Math.random().toString(36).slice(2)}`;
  try {
    await redisFetch("/set", { key, value: JSON.stringify({ ping: "pong" }), ex: 60 });
    const got = await redisFetch("/get", { key });
    const raw = got?.result ?? null;
    const ok = !!raw;
    LAST_STORE = "redis";
    return { env, ok, store: LAST_STORE, error: REDIS_LAST_ERROR };
  } catch (e: any) {
    LAST_STORE = "memory";
    return { env, ok: false, store: LAST_STORE, error: String(REDIS_LAST_ERROR || e?.message || e) };
  }
}
