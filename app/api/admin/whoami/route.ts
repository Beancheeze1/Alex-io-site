import { NextResponse } from "next/server";

/**
 * Minimal whoami to clear 404.
 * We can wire real HubSpot portal details after this returns 200 JSON.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    hasToken: false,        // flip this when you wire real token detection
    note: "admin/whoami route live",
    t: new Date().toISOString(),
  });
}
