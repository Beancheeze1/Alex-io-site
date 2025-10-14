// app/api/_admin/check-thread/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";
// NOTE: depth is 5 levels up from app/api/_admin/check-thread/route.js to project root.
import { getThreadById } from "../../../../../lib/hubspot.js";

export async function GET(req) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");

  console.log("[CHECK-THREAD] Incoming", { path: url.pathname, threadId });

  if (!threadId) {
    console.warn("[CHECK-THREAD] missing threadId");
    return NextResponse.json({ error: "missing threadId" }, { status: 400 });
  }

  try {
    const t = await getThreadById(threadId);
    const out = {
      threadId,
      conversationId: t?.conversationId ?? null,
      channelType: t?.channelType ?? null,
      channelId: t?.channelId ?? null,
      lastMessageSenderType: t?.lastMessage?.sender?.type ?? null
    };
    console.log("[CHECK-THREAD] OK", out);
    return NextResponse.json(out);
  } catch (e) {
    console.error("[CHECK-THREAD] ERROR", String(e?.message || e));
    return NextResponse.json(
      { error: "HUBSPOT_FETCH_FAILED", details: String(e?.message || e) },
      { status: 502 }
    );
  }
}
