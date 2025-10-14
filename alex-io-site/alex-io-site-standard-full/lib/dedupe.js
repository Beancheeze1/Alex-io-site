// lib/dedupe.js
// Hybrid idempotency & per-thread cooldown: Redis (preferred) with memory fallback.

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

function hasRedis() { return Boolean(REDIS_URL && REDIS_TOKEN); }

async function rjson(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  const t = await r.text();
  try { return { ok: r.ok, json: JSON.parse(t), raw: t }; }
  catch { return { ok: r.ok, json: null, raw: t }; }
}

// ---- Redis ops (REST) ----
async function redisSetNX(key, ttlSec) {
  const { ok, raw } = await rjson(`${REDIS_URL}/set/${encodeURIComponent(key)}/1?NX=1&EX=${ttlSec}`);
  return ok && /OK|true/i.test(raw);
}
async function redisGet(key) {
  const { ok, json } = await rjson(`${REDIS_URL}/get/${encodeURIComponent(key)}`);
  return ok ? json?.result ?? null : null;
}
async function redisSetEX(key, value, ttlSec) {
  const { ok, raw } = await rjson(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSec}`);
  return ok && /OK|true/i.test(raw);
}
async function redisTTL(key) {
  const { ok, json } = await rjson(`${REDIS_URL}/ttl/${encodeURIComponent(key)}`);
  // Upstash returns { result: seconds } or -2(no key) / -1(no expiry)
  if (!ok) return null;
  const sec = Number(json?.result);
  return Number.isFinite(sec) ? sec : null;
}
async function redisDel(key) {
  await rjson(`${REDIS_URL}/del/${encodeURIComponent(key)}`);
}

// ---- Memory fallback ----
const seenMem = new Map();   // key -> expiry(ms)
const postMem = new Map();   // threadId -> expiry(ms)
function now() { return Date.now(); }
function sweep(map) { const t = now(); for (const [k, exp] of map) if (t > exp) map.delete(k); }

// Idempotency: return true if this key hasn't been seen in ttl (and remember it)
export async function remember(key, ttlMs = 5 * 60 * 1000) {
  if (hasRedis()) {
    try { return await redisSetNX(`seen:${key}`, Math.ceil(ttlMs / 1000)); }
    catch {/* fallthrough */}
  }
  sweep(seenMem);
  if (seenMem.has(key)) return false;
  seenMem.set(key, now() + ttlMs);
  return true;
}

// Per-thread cooldown: true if we may post now (and record it)
export async function canPost(threadId, cooldownMs = 10 * 60 * 1000) {
  if (hasRedis()) {
    try {
      const key = `cooldown:${threadId}`;
      const existing = await redisGet(key);
      if (existing) return false;
      await redisSetEX(key, "1", Math.ceil(cooldownMs / 1000));
      return true;
    } catch {/* fallthrough */}
  }
  sweep(postMem);
  const exp = postMem.get(threadId) || 0;
  if (now() < exp) return false;
  postMem.set(threadId, now() + cooldownMs);
  return true;
}

// NEW: remaining cooldown seconds (null = no key)
export async function getCooldownTTL(threadId) {
  if (hasRedis()) {
    try { return await redisTTL(`cooldown:${threadId}`); }
    catch { return null; }
  }
  sweep(postMem);
  const exp = postMem.get(threadId);
  if (!exp) return null;
  const ms = exp - now();
  return ms > 0 ? Math.ceil(ms / 1000) : null;
}

// NEW: clear cooldown for a thread
export async function clearCooldown(threadId) {
  if (hasRedis()) {
    try { await redisDel(`cooldown:${threadId}`); return true; }
    catch { /* fallthrough */ }
  }
  postMem.delete(threadId);
  return true;
}
