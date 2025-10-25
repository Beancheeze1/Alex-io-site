import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let events: any = [];
  try { events = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid-json" }, { status: 400 }); }

  return NextResponse.json({
    ok: true,
    received: Array.isArray(events) ? events.length : 0,
    sample: Array.isArray(events) ? events[0] : events,
    note: "processor received and parsed",
  });
}
