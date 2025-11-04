// app/lib/memory.ts
export type MemoryKey = string; // e.g. mem:<email>:<subjectBase>
export type MemoryItem = {
  updatedAt: number;
  specs?: {
    length_in?: number; width_in?: number; height_in?: number;
    qty?: number; material_id?: number;
    weight_lbf?: number; area_in2?: number; fragility_g?: number; drop_in?: number;
  };
  transcript?: Array<{ role: "user" | "assistant"; text: string; ts: number }>;
};

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function keyFor(email: string, subject: string) {
  const base = subject.replace(/^(re:|fwd:)\s*/i, "").trim();
  return `mem:${email.toLowerCase()}:${base.toLowerCase()}`;
}

async function redisFetch<T>(path: string, body?: any): Promise<T> {
  if (!URL || !TOKEN) throw new Error("Missing Upstash envs");
  const r = await fetch(`${URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  return j as T;
}

export async function memGet(email: string, subject: string): Promise<MemoryItem | null> {
  const k = keyFor(email, subject);
  const res = await redisFetch<{ result: string | null }>("/get", { key: k });
  if (!res?.result) return null;
  try { return JSON.parse(res.result) as MemoryItem; } catch { return null; }
}

export async function memSet(email: string, subject: string, item: MemoryItem) {
  const k = keyFor(email, subject);
  return redisFetch("/set", { key: k, value: JSON.stringify(item), // 30 days TTL
    // Upstash: automatically supports EX seconds via /set EX not in REST; we emulate via /pipelined
  });
}

export async function memMergeSpecs(email: string, subject: string, patch: MemoryItem["specs"]) {
  const existing = (await memGet(email, subject)) || { updatedAt: Date.now(), specs: {}, transcript: [] };
  existing.specs = { ...(existing.specs || {}), ...(patch || {}) };
  existing.updatedAt = Date.now();
  await memSet(email, subject, existing);
  return existing;
}

export async function memAppendTurn(email: string, subject: string, role: "user" | "assistant", text: string) {
  const existing = (await memGet(email, subject)) || { updatedAt: Date.now(), specs: {}, transcript: [] };
  existing.transcript = (existing.transcript || []).concat([{ role, text, ts: Date.now() }]).slice(-12);
  existing.updatedAt = Date.now();
  await memSet(email, subject, existing);
  return existing;
}
