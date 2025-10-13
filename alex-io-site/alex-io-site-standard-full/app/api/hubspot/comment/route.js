// app/api/hubspot/comment/route.js
import { NextResponse } from "next/server";
import { getConversationIdFromThread, postHubSpotMessage } from "@/lib/hubspot";

export async function POST(req) {
  try {
    const { conversationId: cid, threadId, text } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "Missing 'text' field" }, { status: 400 });
    }

    let conversationId = cid;
    if (!conversationId && threadId) {
      conversationId = await getConversationIdFromThread(threadId);
    }
    if (!conversationId) {
      return NextResponse.json(
        { error: "Provide 'conversationId' or 'threadId'" },
        { status: 400 }
      );
    }

    console.log("[comment] posting", {
      conversationId,
      fromThreadId: threadId || null,
      textPreview: text.slice(0, 80),
    });

    const result = await postHubSpotMessage(conversationId, text);
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err) {
    console.error("[comment] error", err?.message);
    return NextResponse.json({ error: err?.message ?? "unknown" }, { status: 500 });
  }
}

