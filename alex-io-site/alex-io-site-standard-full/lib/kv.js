// lib/kv.js
import { Redis } from "@upstash/redis";

const hasRedis = !!process.env.REDIS_URL && !!process.env.REDIS_TOKEN;

let memory = new Map();
function now() { return Math.floor(Date.now() / 1000); }

export const kv = hasRedis
  ? new Redis({ url: process.env.REDIS_URL, token: process.env.REDIS_TOKEN })
  : {
      async get(key) {
        const hit = memory.get(key);
        if (!hit) return null;
        if (hit.expiresAt <= now()) { memory.delete(key); return null; }
        return hit.value;
      },
      async set(key, value, opts) {
        const ttl = (opts && opts.ex) ? opts.ex : 3600;
        memory.set(key, { value, expiresAt: now() + ttl });
      },
      async del(key) { memory.delete(key); }
    };

export async function seen(key) {
  const v = await kv.get(key);
  return v !== null;
}

export async function mark(key, ttlSeconds) {
  await kv.set(key, "1", { ex: ttlSeconds });
}
