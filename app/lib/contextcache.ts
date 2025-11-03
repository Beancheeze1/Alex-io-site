// /app/lib/contextCache.ts
//
// Simple per-thread context store on top of the existing KV helper.
// We store a compact record so the bot can remember the last quote
// and continue the conversation naturally.

import { makeKv } from "@/app/lib/kv";

export interface ThreadContext {
  lastIntent?: string;
  lastDims?: { l: number; w: number; h: number; units: "in" };
  lastQty?: number;
  lastMaterial?: string;
  lastDensity?: number;
  lastEstimate?: {
    unitPrice: number;
    total: number;
    minCharge: number;
    wastePct: number;
    summary: string;
  };
  updatedAt: number;
}

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function keyFor(threadId: string) {
  return `alexio:ctx:${threadId}`;
}

export async function getThreadContext(threadId: string): Promise<ThreadContext | null> {
  const kv = makeKv();
  // NOTE: kv.get is not generic in our wrapper
  const raw = await kv.get(keyFor(threadId));
  if (!raw) return null;

  try {
    // kv.get returns string (or null). Parse defensively.
    return JSON.parse(String(raw)) as ThreadContext;
  } catch {
    return null;
  }
}

export async function setThreadContext(threadId: string, ctx: ThreadContext): Promise<void> {
  const kv = makeKv();
  const payload = JSON.stringify({ ...ctx, updatedAt: Date.now() });
  // NOTE: kv.set expects (key, value, ttlSeconds: number)
  await kv.set(keyFor(threadId), payload, TTL_SECONDS);
}

export async function updateThreadContext(
  threadId: string,
  patch: Partial<ThreadContext>
): Promise<ThreadContext> {
  const current = (await getThreadContext(threadId)) ?? { updatedAt: Date.now() };
  const next: ThreadContext = { ...current, ...patch, updatedAt: Date.now() };
  await setThreadContext(threadId, next);
  return next;
}
