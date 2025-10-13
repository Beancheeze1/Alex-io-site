// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";

// Quick GET so you can test in a browser
export async function GET() {
  return NextResponse.json(
    { ok: true, path: "/api/hubspot/webhook", method: "GET" },
    { status: 200 }
  );
}

// IMPORTANT: HubSpot sends POST. This MUST exist (405 = missing/blocked POST)
export async function POST(req) {
  // read the body (HubSpot sends an array of events)
  const raw = await req.text();
  console.log("🔔 HubSpot webhook POST hit. First 500 chars:", raw?.slice(0, 500) || "<empty>");

  // Always return 200 fast so HubSpot doesn’t retry
  return NextResponse.json({ ok: true, received: true }, { status: 200 });
}
