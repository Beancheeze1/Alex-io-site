// app/lib/memory.ts
//
// Simple hybrid memory layer used by the AI orchestrator.
// - Primary store: Upstash Redis REST (if configured)
// - Fallback: in-process Map (for local dev / missing envs)
//
export type Mem = Record<string, any>;
export type StoreName = "redis" | "memory";

const FALLBACK = new Map<string, Mem>();

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
const REDIS_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const TTL_DAYS = Number(process.env.ALEXIO_MEM_TTL_DAYS || 14);
const TTL_SEC = Math.max(1, TTL_DAYS) * 24 * 60 * 60;

export let LAST_STORE: StoreName = "memory";
export let REDIS_LAST_ERROR: string | null = null;

function keyFor(threadId: string | number | null | undefined): string {
  const raw = threadId == null ? "" : String(threadId);
  const trimmed = raw.trim();
  if (!trimmed) return "thread:anon";
  return `thread:${trimmed}`;
}

type RedisCmd = [string, ...string[]];

async function redisPipeline(cmds: RedisCmd[]): Promise<{ result: string | null }[]> {
  if (!REDIS_URL || !REDIS_TOKEN) {
    LAST_STORE = "memory";
    return [];
  }

  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commands: cmds }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(json)) {
      LAST_STORE = "memory";
      REDIS_LAST_ERROR = "redis_pipeline_error";
      return [];
    }

    LAST_STORE = "redis";
    REDIS_LAST_ERROR = null;

    return json.map((entry: any) => ({
      result: entry?.result ?? null,
    }));
  } catch (e: any) {
    LAST_STORE = "memory";
    REDIS_LAST_ERROR = String(e?.message || e);
    return [];
  }
}

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out as T;
}

function shallowMerge(a: Mem, b: Mem): Mem {
  const bb = compact(b || {});
  return { ...(a || {}), ...bb };
}

export async function loadFacts(
  threadId: string | number | null | undefined
): Promise<Mem> {
  const k = keyFor(threadId);

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const out = await redisPipeline([["GET", k]]);
      const raw = out?.[0]?.result ?? null;
      if (!raw) {
        LAST_STORE = "redis";
        REDIS_LAST_ERROR = null;
        return {};
      }
      try {
        const parsed = JSON.parse(String(raw));
        LAST_STORE = "redis";
        REDIS_LAST_ERROR = null;
        return parsed && typeof parsed === "object" ? (parsed as Mem) : {};
      } catch {
        LAST_STORE = "redis";
        REDIS_LAST_ERROR = null;
        return {};
      }
    } catch (e: any) {
      REDIS_LAST_ERROR = String(e?.message || e);
    }
  }

  LAST_STORE = "memory";
  return FALLBACK.get(k) || {};
}

export async function saveFacts(
  threadId: string | number | null | undefined,
  patch: Mem
): Promise<void> {
  const k = keyFor(threadId);
  const current = await loadFacts(threadId);
  const merged = shallowMerge(current, patch || {});

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await redisPipeline([
        ["SET", k, JSON.stringify(merged), "EX", String(TTL_SEC)],
      ]);
      LAST_STORE = "redis";
      REDIS_LAST_ERROR = null;
      return;
    } catch (e: any) {
      REDIS_LAST_ERROR = String(e?.message || e);
    }
  }

  LAST_STORE = "memory";
  FALLBACK.set(k, merged);
}

// NEW (Bundle 2): helper to load/save across multiple keys
// (e.g. threadId + quote_no) – we’ll start using this in a
// follow-up bundle when we bridge email ↔ quote memory.
export async function loadFactsMulti(
  ids: (string | number | null | undefined)[]
): Promise<Mem> {
  let merged: Mem = {};
  for (const id of ids) {
    if (id == null) continue;
    const key = String(id).trim();
    if (!key) continue;
    const part = await loadFacts(id);
    if (part && typeof part === "object") {
      merged = shallowMerge(merged, part);
    }
  }
  return merged;
}

export async function saveFactsMulti(
  ids: (string | number | null | undefined)[],
  patch: Mem
): Promise<void> {
  for (const id of ids) {
    if (id == null) continue;
    const key = String(id).trim();
    if (!key) continue;
    await saveFacts(id, patch);
  }
}

/** Admin probe used by /api/admin/mem */
export async function memSelfTest(): Promise<{
  ok: boolean;
  env: { url: boolean; token: boolean };
  store: StoreName;
}> {
  const envFlags = { url: !!REDIS_URL, token: !!REDIS_TOKEN };

  if (!envFlags.url || !envFlags.token) {
    LAST_STORE = "memory";
    return { ok: false, env: envFlags, store: LAST_STORE };
  }

  const testKey = keyFor("redis-check-NEW");
  try {
    await redisPipeline([["SET", testKey, "1", "EX", "60"]]);
    const got = await redisPipeline([["GET", testKey]]);
    const ok = got?.[0]?.result === "1";
    LAST_STORE = ok ? "redis" : "memory";
    REDIS_LAST_ERROR = ok ? null : "set/get echoed mismatch";
    return { ok, env: envFlags, store: LAST_STORE };
  } catch (e: any) {
    LAST_STORE = "memory";
    REDIS_LAST_ERROR = String(e?.message || e);
    return { ok: false, env: envFlags, store: LAST_STORE };
  }
}
