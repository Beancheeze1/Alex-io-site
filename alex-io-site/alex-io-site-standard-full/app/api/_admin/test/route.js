// app/api/_admin/test/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, service: "alive" });
}
