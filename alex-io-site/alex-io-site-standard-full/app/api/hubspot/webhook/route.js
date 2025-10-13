// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";

export async function GET() {
  // lets you hit the same path in a browser to verify 200
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook", method: "GET" }, { status: 200 });
}

export async function POST(req) {
  // respond fast so HubSpot sees 200, then log body for now
  const raw = await req.text();
  console.log("🔔 HubSpot webhook hit:", raw?.slice(0, 500) || "<empty>");
  // IMPORTANT: return 200 quickly for HubSpot
  return NextResponse.json({ ok: true, received: true }, { status: 200 });
}
