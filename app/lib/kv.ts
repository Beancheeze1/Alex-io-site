// app/lib/kv.ts
export type Kv = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, val: string, ttlSec?: number) => Promise<boolean>;
};

export function makeKv(): Kv {
  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  if (!base || !token) {
    // no KV configured — return a no-op shim
    return {
      async get() { return null; },
      async set() { return true; },
    };
  }
  async function call(cmd: string[], ttlSec?: number) {
    const body = ttlSec
      ? JSON.stringify([cmd, ["EX", String(ttlSec)]].flat())
      : JSON.stringify(cmd);
    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error(`KV ${cmd[0]} failed ${res.status}`);
    const j = await res.json();
    // Upstash pipeline returns arrays; single command returns {result: ...}
    const result = "result" in j ? j.result : Array.isArray(j) ? j[0].result : null;
    return result;
  }
  return {
    async get(key) { return await call(["GET", key]); },
    async set(key, val, ttlSec) {
      const r = await call(["SET", key, val], ttlSec);
      return r === "OK" || r === true;
    },
  };
}
