// app/api/_admin/whoami/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL ? "set" : "missing",
      HUBSPOT_ACCESS_TOKEN: process.env.HUBSPOT_ACCESS_TOKEN ? "set" : "missing",
      HUBSPOT_SKIP_LOOKUP: process.env.HUBSPOT_SKIP_LOOKUP ?? "0",
      MS_TENANT_ID: !!process.env.MS_TENANT_ID,
      MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
      MS_MAILBOX_FROM: process.env.MS_MAILBOX_FROM || "",
    },
    now: new Date().toISOString(),
  });
}
