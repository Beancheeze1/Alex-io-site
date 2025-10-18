import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET() {
  if (!process.env.BOT_ADMIN_ENABLED) {
    return NextResponse.json({ ok: false, reason: "disabled" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() }, { status: 200 });
}
