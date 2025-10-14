// app/api/_admin/test/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  console.log("[ADMIN] GET /api/_admin/test");
  return NextResponse.json({ ok: true, service: "alive", route: "/api/_admin/test" });
}
