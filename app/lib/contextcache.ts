// app/lib/contextcache.ts
import { makeKv } from "@/app/lib/kv";

const TTL_SECONDS =
  Number(process.env.ALEXIO_CONV_TTL_SECONDS || 60 * 60 * 24 * 2); // default 2 days

export async function loadContext<T = any>(key: string): Promise<T | null> {
  try {
    const kv = makeKv();
    const raw = (await kv.get(key)) as string | null;
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveContext<T = any>(key: string, value: T) {
  try {
    const kv = makeKv();
    // Your KV helper expects TTL as a number, not { ex: number }
    await kv.set(key, JSON.stringify(value), TTL_SECONDS);
  } catch {
    // swallow
  }
}
