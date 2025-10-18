// app/api/ping/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() }, { status: 200 });
}
