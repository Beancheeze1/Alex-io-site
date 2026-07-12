// app/api/admin/mem/check/route.ts
import { NextRequest, NextResponse } from "next/server";
import { memSelfTest, LAST_STORE, REDIS_LAST_ERROR } from "@/app/lib/memory";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  try {
    const probe = await memSelfTest();
    return NextResponse.json(
      {
        ok: probe.ok,
        env: probe.env,
        store: probe.store,
        redis_error: REDIS_LAST_ERROR,
        note: "This does a short Upstash set/get round-trip. No secrets returned.",
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e), store: LAST_STORE, redis_error: REDIS_LAST_ERROR },
      { status: 200 }
    );
  }
}
