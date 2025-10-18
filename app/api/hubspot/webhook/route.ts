import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // You can add signature validation later; for now, accept and 200.
  try {
    const events = await request.json().catch(() => []);
    return NextResponse.json({ ok: true, received: Array.isArray(events) ? events.length : 0 }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: true, received: 0 }, { status: 200 });
  }
}
