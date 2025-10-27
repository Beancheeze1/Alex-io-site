// app/api/health/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Simple health check for Render / uptime / curl.exe probes
 * Returns 200 OK with a basic JSON payload
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    status: 200,
    service: "alex-io-bot",
    timestamp: new Date().toISOString(),
  });
}
