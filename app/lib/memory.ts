// app/lib/memory.ts
// Durable per-thread memory for AI orchestration.
// Uses Upstash Redis REST (no extra dependency). Falls back to in-process Map.

export type Mem = Record<string, any>;

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
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(`${REDIS_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    // never cache; we want freshest copy
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash error ${res.status}`);
  return res.json().catch(() => ({}));
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

  // Redis path
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      // GET value
      const j = await redisFetch("/get", { key: k });
      const raw = j?.result ?? null;
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === "object") ? parsed as Mem : {};
      } catch {
        return {};
      }
    } catch {
      // fall through to Map fallback
    }
  }

  // Fallback Map
  return FALLBACK.get(k) || {};
}

export async function saveFacts(threadId: string | number | null | undefined, patch: Mem): Promise<void> {
  const k = keyFor(threadId);

  // Load current, merge, then persist
  const current = await loadFacts(threadId);
  const merged = shallowMerge(current, patch || {});

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      // SET serialized with TTL
      await redisFetch("/set", { key: k, value: JSON.stringify(merged), ex: TTL_SEC });
      return;
    } catch {
      // fall through to Map fallback
    }
  }

  // Fallback Map
  FALLBACK.set(k, merged);
}
