// lib/kv.js
import { Redis } from "@upstash/redis";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn("⚠️ Upstash Redis env vars missing: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN");
}

export const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const ns = (key) => `alexio:${key}`;
