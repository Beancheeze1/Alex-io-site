// app/api/quote/check/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const t = req.nextUrl.searchParams.get("t") || "";
    if (!t) return NextResponse.json({ ok: false, error: "missing token" }, { status: 400 });
    const kv = makeKv();
    const v = await kv.get(`alexio:quote:${t}`);
    if (!v) return NextResponse.json({ ok: false, found: false }, { status: 404 });
    return NextResponse.json({ ok: true, found: true, data: JSON.parse(v) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
