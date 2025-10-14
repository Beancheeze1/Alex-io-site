// app/api/_admin/check-thread/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getThreadById } from "@/lib/hubspot";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ error: "missing threadId" }, { status: 400 });

  try {
    const t = await getThreadById(threadId);
    const out = {
      threadId,
      conversationId: t?.conversationId ?? null,
      channelType: t?.channelType ?? null,
      channelId: t?.channelId ?? null,
      lastMessageSenderType: t?.lastMessage?.sender?.type ?? null,
    };
    return NextResponse.json(out);
  } catch (e: any) {
    // Don't mask as 404; pass through clues
    return NextResponse.json(
      { error: "HUBSPOT_FETCH_FAILED", details: e?.message || String(e) },
      { status: 502 }
    );
  }
}
