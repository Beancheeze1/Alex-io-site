import crypto from "crypto";

export type TokenRecord = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  hub_id?: number;
  user_id?: string;
  scopes?: string[];
};

const provider = (process.env.TOKEN_STORE_PROVIDER ?? "memory").toLowerCase();
const mem = new Map<string, TokenRecord>();

/** ---------- Optional Redis (Upstash REST) helpers ---------- */

async function redisGet(key: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const json = await res.json();
  return json?.result ? JSON.parse(json.result) : null;
}

async function redisSet(key: string, value: unknown, ttlSeconds?: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  const body = JSON.stringify(value);
  const base = `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(body)}`;
  const finalUrl =
    typeof ttlSeconds === "number" ? `${base}/EX/${ttlSeconds}` : base;

  await fetch(finalUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
}

/** ---------- Optional encryption for stored tokens ---------- */

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || ""; // base64-encoded 32 bytes

function encrypt(plain: string): string {
  if (!ENC_KEY_B64) return plain;
  const key = Buffer.from(ENC_KEY_B64, "base64"); // 32 bytes
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(blob: string): string {
  if (!ENC_KEY_B64) return blob;
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString("utf8");
}

function toStorable(rec: TokenRecord) {
  return {
    ...rec,
    access_token: encrypt(rec.access_token),
    refresh_token: encrypt(rec.refresh_token),
  };
}

function fromStorable(obj: any): TokenRecord {
  return {
    ...obj,
    access_token: decrypt(obj.access_token),
    refresh_token: decrypt(obj.refresh_token),
  };
}

const KEY = (portalId: string | number) => `hs:tokens:${portalId}`;

/** ---------- Public API ---------- */

export const tokenStore = {
  async get(portalId: string | number): Promise<TokenRecord | null> {
    if (provider === "redis") {
      const got = await redisGet(KEY(portalId));
      return got ? fromStorable(got) : null;
    }
    return mem.get(String(portalId)) ?? null;
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
    if (provider === "redis") {
      await redisSet(KEY(portalId), "", 1);
    }
    mem.delete(String(portalId));
  },
};
