// app/api/admin/test/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  console.log("[ADMIN] GET /api/admin/test");
  return NextResponse.json({ ok: true, service: "alive", route: "/api/admin/test" });
}
