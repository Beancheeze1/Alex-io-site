import { NextResponse } from "next/server";

export async function GET() {
  // Minimal JSON so your probes pass even before wiring HubSpot.
  return NextResponse.json({
    ok: true,
    hasToken: false,
    note: "whoami admin route is live (placeholder)",
    fp: "whoami-v1"
  });
}
