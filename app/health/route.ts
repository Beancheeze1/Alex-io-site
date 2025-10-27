// app/health/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "alex-io-bot",
    status: "healthy",
    ts: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime?.() ?? 0)
  });
}
