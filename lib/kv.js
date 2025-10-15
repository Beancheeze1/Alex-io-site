// lib/kv.js
import { Redis } from "@upstash/redis";

<<<<<<< HEAD
const r = process.env.REDIS_URL && process.env.REDIS_TOKEN
=======
const hasRedis = !!process.env.REDIS_URL && !!process.env.REDIS_TOKEN;

let memory = new Map();
function now() { return Math.floor(Date.now() / 1000); }

// lib/kv.js
import { Redis } from "@upstash/redis";
const r = process.env.REDIS_URL && process.env.REDIS_TOKEN
  ? new Redis({ url: process.env.REDIS_URL, token: process.env.REDIS_TOKEN })
  : null;

export function kvForTenant(tenantId) {
  const mem = new Map();
  return {
    async get(k){ return r ? r.get(`${tenantId}:${k}`) : mem.get(k) || null; },
    async set(k,v,o){ return r ? r.set(`${tenantId}:${k}`, v, o) : mem.set(k, v); },
    async del(k){ return r ? r.del(`${tenantId}:${k}`) : mem.delete(k); }
  };
}


export const kv = hasRedis
>>>>>>> f6dd5e74f75b95489f0ed99361ff7fc7c6357b48
  ? new Redis({ url: process.env.REDIS_URL, token: process.env.REDIS_TOKEN })
  : null;

export function kvForTenant(tenantId) {
  const mem = new Map();
  return {
    async get(k){ return r ? r.get(`${tenantId}:${k}`) : (mem.get(k) ?? null); },
    async set(k,v,opts){ return r ? r.set(`${tenantId}:${k}`, v, opts) : mem.set(k, v); },
    async del(k){ return r ? r.del(`${tenantId}:${k}`) : mem.delete(k); },
  };
}
