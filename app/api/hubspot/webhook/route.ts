// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// HubSpot webhooks POST here. Ensure this path matches your HubSpot app config.
export async function POST(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  // Minimal safe log (avoid leaking secrets)
  console.log("🔔 HubSpot webhook received (count):", Array.isArray(payload) ? payload.length : 1);

  // Your prior “conversation.newMessage” logic can slot here
  // Path A: keep minimal; return 200 quickly so HS doesn't retry.
  return NextResponse.json({ ok: true });
}

export async function GET() {
  // Helpful for quick 200 checks from your browser
  return NextResponse.json({ ok: true, route: "hubspot/webhook" });
}
