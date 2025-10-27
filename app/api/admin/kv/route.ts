// app/api/admin/kv/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

async function kvSafe() {
  try {
    const mod = await import("@/lib/kv").catch(() => null as any);
    return (mod?.kv ?? mod?.default) || null;
  } catch { return null; }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "hs:refresh_token";
  const kv = await kvSafe();
  if (!kv?.get) return NextResponse.json({ ok:false, error:"no_kv_library" }, { status: 400 });
  const val = await kv.get(key);
  const s = typeof val === "string" ? val : (val ? JSON.stringify(val) : "");
  return NextResponse.json({
    ok:true,
    key,
    present: !!s,
    length: s.length,
    preview: s ? `${s.slice(0,6)}...${s.slice(-6)}` : null
  });
}
