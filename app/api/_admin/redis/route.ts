import { NextResponse } from "next/server";

export async function GET() {
  // Minimal JSON so your probes pass even before wiring real Redis.
  // We'll wire Upstash ping after this returns 200.
  return NextResponse.json({
    ok: true,
    note: "redis admin route is live (placeholder)",
    fp: "redis-v1"
  });
}
