// app/api/admin/config/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const replyEnabled = String(process.env.REPLY_ENABLED ?? "").toLowerCase() === "true";
  const internalSendUrlSet = Boolean(process.env.INTERNAL_SEND_URL);
  return NextResponse.json({ ok: true, cfg: { replyEnabled, internalSendUrlSet } });
}
