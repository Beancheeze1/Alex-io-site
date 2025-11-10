// app/lib/memory.ts
export type MemFacts = Record<string, any>;

const RURL  = process.env.UPSTASH_REDIS_REST_URL || "";
const RTOK  = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const TTL_S = 14 * 24 * 60 * 60; // 14 days

async function redis(cmd: string[]): Promise<any> {
  if (!RURL || !RTOK) return null;
  const res = await fetch(RURL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${RTOK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ command: cmd }),
    // Render/Next: ensure no cache
    cache: "no-store",
  }).catch(() => null);
  if (!res) return null;
  try { return await res.json(); } catch { return null; }
}

function key(threadId: string | number) {
  return `alexio:mem:${threadId}`;
}

export async function loadFacts(threadId?: string | number): Promise<MemFacts> {
  if (!threadId) return {};
  const r = await redis(["GET", key(threadId)]);
  if (!r || typeof r.result !== "string" || !r.result) return {};
  try { return JSON.parse(r.result) || {}; } catch { return {}; }
}

export async function saveFacts(threadId?: string | number, facts?: MemFacts): Promise<void> {
  if (!threadId || !facts || !Object.keys(facts).length) return;
  const payload = JSON.stringify(facts);
  await redis(["SET", key(threadId), payload, "EX", String(TTL_S)]);
}
