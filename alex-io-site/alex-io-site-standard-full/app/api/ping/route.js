// app/api/ping/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  console.log("[PING] GET /api/ping");
  return NextResponse.json({ ok: true, route: "/api/ping" });
}
