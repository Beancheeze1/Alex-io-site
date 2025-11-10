// app/api/admin/mem/route.ts
import { NextResponse } from "next/server";
import { loadFacts, saveFacts, lastStoreUsed } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const threadId = "mem-probe";
  await saveFacts(threadId, { stamp: Date.now().toString() });
  const loaded = await loadFacts(threadId);
  return NextResponse.json({
    ok: true,
    store: lastStoreUsed,
    hasRedisEnv: !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN,
    sample: loaded,
  });
}
