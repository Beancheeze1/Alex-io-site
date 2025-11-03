// app/api/admin/webhooks/last/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Temporary shim to unblock build; returns empty log list */
export async function GET() {
  return NextResponse.json(
    { ok: true, route: "/api/admin/webhooks/last", items: [], note: "shim" },
    { status: 200 }
  );
}
