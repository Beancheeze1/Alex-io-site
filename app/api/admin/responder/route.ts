// app/api/admin/responder/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Temporary shim to unblock build; echoes payload */
export async function GET() {
  return NextResponse.json(
    { ok: true, route: "/api/admin/responder", mode: "GET", note: "shim" },
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {}
  return NextResponse.json(
    { ok: true, route: "/api/admin/responder", mode: "POST", body, note: "shim" },
    { status: 200 }
  );
}
