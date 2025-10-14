// lib/dedupe.js
// Simple in-memory TTL cache for idempotency & per-thread cooldown.
const seen = new Map();         // key -> { ts }
const lastPost = new Map();     // threadId -> timestamp (ms)

function now() { return Date.now(); }

export function remember(key, ttlMs = 5 * 60 * 1000) {
  const t = now();
  // purge stale
  for (const [k, v] of seen) if (t - v.ts > ttlMs) seen.delete(k);
  if (seen.has(key)) return false;     // already seen within TTL
  seen.set(key, { ts: t });
  return true;
}

export function canPost(threadId, cooldownMs = 10 * 60 * 1000) {
  const t = now();
  // purge stale lastPost entries over a day old
  for (const [k, v] of lastPost) if (t - v > 24 * 60 * 60 * 1000) lastPost.delete(k);
  const last = lastPost.get(threadId) || 0;
  if (t - last < cooldownMs) return false;
  lastPost.set(threadId, t);
  return true;
}

