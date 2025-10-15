// lib/dedupe.js
// Hybrid idempotency & per-thread cooldown with optional Redis (Upstash) + memory fallback.

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

function hasRedis() { return Boolean(REDIS_URL && REDIS_TOKEN); }
function now() { return Date.now(); }

async function r(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  const text = await res.text();
  try { return { ok: res.ok, json: JSON.parse(text), raw: text }; }
  catch { return { ok: res.ok, json: null, raw: text }; }
}

// ---- Redis ops ----
async function redisSetNX(key, ttlSec) {
  const { ok, raw } = await r(`${REDIS_URL}/set/${encodeURIComponent(key)}/1?NX=1&EX=${ttlSec}`);
  return ok && /OK|true/i.test(raw);
}
async function redisGet(key) {
  const { ok, json } = await r(`${REDIS_URL}/get/${encodeURIComponent(key)}`);
  return ok ? json?.result ?? null : null;
}
async function redisSetEX(key, value, ttlSec) {
  const { ok, raw } = await r(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSec}`);
  return ok && /OK|true/i.test(raw);
}
async function redisTTL(key) {
  const { ok, json } = await r(`${REDIS_URL}/ttl/${encodeURIComponent(key)}`);
  if (!ok) return null;
  const sec = Number(json?.result);
  return Number.isFinite(sec) ? sec : null;
}
async function redisDel(key) {
  await r(`${REDIS_URL}/del/${encodeURIComponent(key)}`);
}

// ---- Memory fallback ----
const seenMem = new Map();          // key -> expiry(ms)
const cooldownMem = new Map();      // threadId -> expiry(ms)
const postedOnceMem = new Map();    // threadId -> expiry(ms)

function sweep(map) { const t = now(); for (const [k, exp] of map) if (t > exp) map.delete(k); }

// Idempotency: return true if this key hasn't been seen in TTL (and remember it)
export async function remember(key, ttlMs = 3 * 60 * 1000) {
  if (hasRedis()) {
    try { return await redisSetNX(`seen:${key}`, Math.ceil(ttlMs / 1000)); }
    catch { /* fall back */ }
  }
  sweep(seenMem);
  if (seenMem.has(key)) return false;
  seenMem.set(key, now() + ttlMs);
  return true;
}

// Per-thread cooldown: true if we may post now (and record it)
export async function canPost(threadId, cooldownMs = 0) {
  if (cooldownMs <= 0) return true;
  if (hasRedis()) {
    try {
      const key = `cooldown:${threadId}`;
      if (await redisGet(key)) return false;
      await redisSetEX(key, "1", Math.ceil(cooldownMs / 1000));
      return true;
    } catch { /* fall back */ }
  }
  sweep(cooldownMem);
  const exp = cooldownMem.get(threadId) || 0;
  if (now() < exp) return false;
  cooldownMem.set(threadId, now() + cooldownMs);
  return true;
}

// Remaining cooldown (seconds) or null
export async function getCooldownTTL(threadId) {
  if (hasRedis()) {
    try { return await redisTTL(`cooldown:${threadId}`); } catch { return null; }
  }
  sweep(cooldownMem);
  const exp = cooldownMem.get(threadId);
  if (!exp) return null;
  const ms = exp - now();
  return ms > 0 ? Math.ceil(ms / 1000) : null;
}

// --- NEW: clear helpers ---

// Clear a specific dedupe key (what you see in logs, e.g. "msg:...").
export async function clearDedupeKey(key) {
  if (!key) return false;
  if (hasRedis()) { try { await redisDel(`seen:${key}`); } catch {} }
  seenMem.delete(key);
  return true;
}

// Clear cooldown + "posted once" locks for a thread (if you added postedOnce).
export async function clearThreadLocks(threadId) {
  if (!threadId) return false;
  if (hasRedis()) {
    try { await redisDel(`cooldown:${threadId}`); } catch {}
    try { await redisDel(`postedOnce:${threadId}`); } catch {}
  }
  cooldownMem.delete(threadId);
  postedOnceMem.delete(threadId);
  return true;
}

// (Optional) if you implement "posted once" policy:
export async function wasThreadPosted(threadId) {
  if (hasRedis()) { try { return Boolean(await redisGet(`postedOnce:${threadId}`)); } catch {} }
  const exp = postedOnceMem.get(threadId);
  return Boolean(exp && exp > now());
}
export async function markThreadPosted(threadId, ttlMs = 24 * 60 * 60 * 1000) {
  if (hasRedis()) { try { await redisSetEX(`postedOnce:${threadId}`, "1", Math.ceil(ttlMs / 1000)); return true; } catch {} }
  postedOnceMem.set(threadId, now() + ttlMs);
  return true;
}
