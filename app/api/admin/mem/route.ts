// app/api/admin/mem/route.ts
//
// Simple memory/debug endpoint.
// - GET /api/admin/mem          -> shows memSelfTest + store info
// - GET /api/admin/mem?key=XYZ  -> same plus the facts for that key
//
// USE ONLY FOR INTERNAL DEBUG (no auth yet).

import { NextRequest, NextResponse } from "next/server";
import { loadFacts, memSelfTest, LAST_STORE, REDIS_LAST_ERROR } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") || url.searchParams.get("id") || null;

    const test = await memSelfTest();

    if (!key) {
      return NextResponse.json(
        {
          ok: true,
          mode: "summary",
          test,
          lastStore: LAST_STORE,
          redisError: REDIS_LAST_ERROR,
        },
        { status: 200 }
      );
    }

    const facts = await loadFacts(key);

    return NextResponse.json(
      {
        ok: true,
        mode: "by-key",
        key,
        test,
        lastStore: LAST_STORE,
        redisError: REDIS_LAST_ERROR,
        facts,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "admin_mem_exception",
        detail: String(e?.message || e),
      },
      { status: 500 }
    );
  }
}
