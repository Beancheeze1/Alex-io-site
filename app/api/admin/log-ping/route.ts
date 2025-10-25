// app/api/admin/log-ping/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";       // ensure logs hit Render
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const msg = searchParams.get("msg") ?? "no-msg";
  const now = new Date().toISOString();
  console.log(`[LOG-PING] ${now} :: ${msg}`);
  return NextResponse.json({ ok: true, now, msg });
}
