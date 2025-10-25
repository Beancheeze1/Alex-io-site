// app/api/admin/db/health/route.ts
import { NextResponse } from "next/server";
import { dbPing } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // IMPORTANT: Node runtime, not Edge

export async function GET() {
  try {
    const ok = await dbPing();
    return NextResponse.json({ ok, driver: "postgres" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
