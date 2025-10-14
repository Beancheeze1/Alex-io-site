// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";

// Minimal, always-200 webhook to prove connectivity & eliminate timeouts/crashes.
export async function POST(req) {
  try {
    const raw = await req.text(); // don't parse; never throws
    console.log("[webhook][POST] len:", raw?.length ?? 0);
    return NextResponse.json({ ok: true, ack: "fast" }, { status: 200 });
  } catch (e) {
    // Even on unexpected errors, return 200 so HubSpot doesn't see 5xx
    console.error("[webhook] fast-ack error:", e?.message);
    return NextResponse.json({ ok: true, note: "handled error" }, { status: 200 });
  }
}

// Keep GET so you can check quickly in a browser
export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}
