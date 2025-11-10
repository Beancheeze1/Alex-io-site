// app/lib/memory.ts
// Durable per-thread memory for AI orchestration.
// Uses Upstash Redis REST (correct REST shape). Falls back to in-process Map only if Redis is not configured.

export type Mem = Record<string, any>;

const FALLBACK = new Map<string, Mem>();

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

// keep facts for 2 weeks (configurable)
const TTL_DAYS = Number(process.env.ALEXIO_MEM_TTL_DAYS ?? 14);
const TTL_SEC = Math.max(1, TTL_DAYS) * 24 * 60 * 60;

function keyFor(threadId: string | number | null | undefined) {
  const id = (threadId ?? "").toString().trim();
  const env = process.env.NODE_ENV || "production"; // namespace to avoid dev/prod mixing
  return `alexio:mem:${env}:${id || "no-thread"}`;
}

function hasRedis() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

async function redisGet(key: string): Promise<string | null> {
  if (!hasRedis()) return null;
  const url = `${REDIS_URL!.replace(/\/+$/, "")}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => ({} as any));
  // Upstash returns { result: "<value or null>" }
  return typeof j?.result === "string" ? j.result : null;
}

async function redisSet(key: string, value: string, exSeconds: number): Promise<boolean> {
  if (!hasRedis()) return false;
  const url = `${REDIS_URL!.replace(/\/+$/, "")}/set/${encodeURIComponent(key)}`;
  const body = { value, ex: exSeconds };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const j = await res.json().catch(() => ({} as any));
  // { result: "OK" } on success
  return j?.result === "OK";
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
  // b wins only for defined keys
  const bb = compact(b || {});
  return { ...(a || {}), ...bb };
}

export async function loadFacts(threadId: string | number | null | undefined): Promise<Mem> {
  const k = keyFor(threadId);

  // Try Redis first
  const raw = await redisGet(k);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object") ? (parsed as Mem) : {};
    } catch {
      // bad JSON in store — treat as empty
      return {};
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
  const serialized = JSON.stringify(merged);

  // Try Redis
  if (await redisSet(k, serialized, TTL_SEC)) return;

  // Fallback Map
  FALLBACK.set(k, merged);
}
