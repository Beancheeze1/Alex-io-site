// app/lib/memory.ts
// Durable per-thread memory for AI orchestration.
// Uses Upstash Redis REST (no extra dependency). Falls back to in-process Map.

export type Mem = Record<string, any>;

const FALLBACK = new Map<string, Mem>();

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const TTL_DAYS = Number(process.env.ALEXIO_MEM_TTL_DAYS ?? 14);
const TTL_SEC = Math.max(1, TTL_DAYS) * 24 * 60 * 60;

function keyFor(threadId: string | number | null | undefined) {
  const id = (threadId ?? "").toString().trim();
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
  const bb = compact(b || {});
  return { ...(a || {}), ...bb };
}

function sanitize(raw: any): Mem {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") return sanitize(j);
      return {};
    } catch {
      return {};
    }
  }
  // unwrap common Upstash wrapper objects
  if (raw?.result) return sanitize(raw.result);
  if (raw?.value) return sanitize(raw.value);
  // filter non-scalar fields
  const cleaned: Mem = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && !Array.isArray(v)) continue;
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

export async function loadFacts(threadId: string | number | null | undefined): Promise<Mem> {
  const k = keyFor(threadId);
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const j = await redisFetch("/get", { key: k });
      const parsed = sanitize(j?.result ?? j);
      return parsed;
    } catch (e) {
      console.error("[memory] loadFacts error", e);
    }
  }
  return FALLBACK.get(k) || {};
}

export async function saveFacts(threadId: string | number | null | undefined, patch: Mem): Promise<void> {
  const k = keyFor(threadId);
  const current = await loadFacts(threadId);
  const merged = shallowMerge(current, patch || {});
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await redisFetch("/set", { key: k, value: JSON.stringify(merged), ex: TTL_SEC });
      return;
    } catch (e) {
      console.error("[memory] saveFacts error", e);
    }
  }
  FALLBACK.set(k, merged);
}
