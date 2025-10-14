// app/api/_admin/check-thread/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getThreadById } from "../../../../../lib/hubspot.js"; // 4 levels up to lib/

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ error: "missing threadId" }, { status: 400 });

  try {
    const t = await getThreadById(threadId);
    return NextResponse.json({
      threadId,
      conversationId: t?.conversationId ?? null,
      channelType: t?.channelType ?? null,
      channelId: t?.channelId ?? null,
      lastMessageSenderType: t?.lastMessage?.sender?.type ?? null
    });
  } catch (e) {
    return NextResponse.json(
      { error: "HUBSPOT_FETCH_FAILED", details: String(e?.message || e) },
      { status: 502 }
    );
  }
}
