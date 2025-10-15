// app/api/admin/thread-messages/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getThreadMessages } from "../../../../lib/hubspot.js";

export async function GET(req) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  const limit = Number(url.searchParams.get("limit") || 10);
  if (!threadId) return NextResponse.json({ error: "missing threadId" }, { status: 400 });

  try {
    const data = await getThreadMessages(threadId, limit);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
