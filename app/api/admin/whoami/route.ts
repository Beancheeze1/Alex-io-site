// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";
import { kvPing } from "@/lib/kv";
import { tokenStore } from "@/lib/tokenStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request) {
  try {
    // 1) Token status from the canonical store (.data/tokens.json)
    const tok = tokenStore.get(); // default portal bucket
    const hasAccess = !!tok?.access_token;
    const hasRefresh = !!tok?.refresh_token;

    // 2) KV status (Upstash if configured, else memory)
    const kv = await kvPing(); // { ok, provider, roundtripMs?, error? }

    return NextResponse.json({
      ok: true,
      authorized: hasAccess && hasRefresh,
      tokens: { access: hasAccess, refresh: hasRefresh },
      kv,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
