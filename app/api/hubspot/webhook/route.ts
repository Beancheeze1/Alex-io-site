import { NextResponse } from "next/server";
// Path A: relative import only
import { tokenStore } from "../../../../lib/tokenStore";
void tokenStore;

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/hubspot/webhook", method: "GET" }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    let events: any[] = [];
    try {
      const parsed = JSON.parse(raw);
      events = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.events) ? (parsed as any).events : [];
    } catch {
      return NextResponse.json({ ok: false, step: "parse", error: "invalid_json" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, method: "POST", received: events.length }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: "exception", error: e?.message || String(e) }, { status: 500 });
  }
}
