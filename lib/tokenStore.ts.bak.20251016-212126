// lib/tokenStore.ts
import crypto from "crypto";

type TokenRecord = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  hub_id?: number;
  user_id?: string;
  scopes?: string[];
};

const provider = process.env.TOKEN_STORE_PROVIDER?.toLowerCase() || "memory";

const mem = new Map<string, TokenRecord>();

// Optional Redis (Upstash REST)
async function redisGet(key: string) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.result ? JSON.parse(json.result) : null;
}

async function redisSet(key: string, value: unknown, ttlSeconds?: number) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return;
  const body = JSON.stringify(value);
  const base = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`;
  const url = ttlSeconds ? `${base}/${encodeURIComponent(body)}/EX/${ttlSeconds}` : `${base}/${encodeURIComponent(body)}`;
  await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    cache: "no-store",
  });
}

// Simple encryption so we’re not storing raw tokens in memory/redis
const ENC_KEY = process.env.ENCRYPTION_KEY || ""; // base64 32 bytes
function enc(data: string) {
  if (!ENC_KEY) return data;
  const key = Buffer.from(ENC_KEY, "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}
function dec(blob: string) {
  if (!ENC_KEY) return blob;
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const key = Buffer.from(ENC_KEY, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString("utf8");
}

function toStorable(rec: TokenRecord) {
  return {
    ...rec,
    access_token: enc(rec.access_token),
    refresh_token: enc(rec.refresh_token),
  };
}
function fromStorable(rec: any): TokenRecord {
  return {
    ...rec,
    access_token: dec(rec.access_token),
    refresh_token: dec(rec.refresh_token),
  };
}

const KEY = (portalId: string | number) => `hs:tokens:${portalId}`;

export const tokenStore = {
  async get(portalId: string | number): Promise<TokenRecord | null> {
    if (provider === "redis") {
      const got = await redisGet(KEY(portalId));
      return got ? fromStorable(got) : null;
    }
    const v = mem.get(String(portalId));
    return v ?? null;
  },

  async set(portalId: string | number, rec: TokenRecord) {
    const ttl = Math.max(1, Math.floor(rec.expires_at - Date.now() / 1000));
    if (provider === "redis") {
      await redisSet(KEY(portalId), toStorable(rec), ttl);
    } else {
      mem.set(String(portalId), rec);
    }
  },

  async clear(portalId: string | number) {
    if (provider === "redis") await redisSet(KEY(portalId), "", 1);
    mem.delete(String(portalId));
  },
};
