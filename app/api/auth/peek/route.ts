import { NextResponse } from "next/server";
import { tokenStore } from "@/lib/tokenStore";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireEnv();
    const keys = tokenStore.listKeys();
    const rows = keys.map(k => {
      const rec = tokenStore.get(/^\d+$/.test(k) ? Number(k) : undefined);
      return {
        key: k,
        hubId: rec?.hubId ?? null,
        hasToken: !!rec?.access_token,
        expiresIn: rec?.expires_in ?? null,
        obtainedAt: rec?.obtained_at ?? null,
      };
    });
    const def = tokenStore.get();
    return NextResponse.json({
      ok: true,
      portals: keys,
      default: {
        hasToken: !!def?.access_token,
        hubId: def?.hubId ?? null,
        expiresIn: def?.expires_in ?? null,
        obtainedAt: def?.obtained_at ?? null
      },
      entries: rows
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
