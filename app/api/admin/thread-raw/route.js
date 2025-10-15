// app/api/admin/thread-raw/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getThreadById } from "../../../../lib/hubspot.js";

export async function GET(req) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ error: "missing threadId" }, { status: 400 });

  try {
    const t = await getThreadById(threadId);
    return NextResponse.json({ ok: true, thread: t });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
