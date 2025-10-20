// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  let payload: any; try { payload = await req.json(); } catch { payload = null; }
  console.log("🔔 HubSpot webhook received:", Array.isArray(payload) ? payload.length : 1);
  return NextResponse.json({ ok: true });
}
export async function GET() { return NextResponse.json({ ok: true, route: "/api/hubspot/webhook", method: "GET" }); }
export {};
