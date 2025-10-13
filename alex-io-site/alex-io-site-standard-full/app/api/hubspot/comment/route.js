// app/api/hubspot/comment/route.js
import { NextResponse } from "next/server";
import {
  postMessageToThread,
  getConversationIdFromThread,
  postHubSpotMessage,
} from "@/lib/hubspot";

/**
 * Body examples:
 *  { "threadId": "9639805666", "text": "Hello!" }
 *  { "conversationId": "123456789", "text": "Hello!" }
 */
export async function POST(req) {
  try {
    const { threadId, conversationId, text } = await req.json();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

    // Prefer thread path if provided
    if (threadId) {
      const out = await postMessageToThread(threadId, text);
      return NextResponse.json({ ok: true, via: "thread", out }, { status: 200 });
    }

    if (conversationId) {
      const out = await postHubSpotMessage(conversationId, text, { kind: "conversation" });
      return NextResponse.json({ ok: true, via: "conversation", out }, { status: 200 });
    }

    // If neither provided, try reading threadId and resolving
    return NextResponse.json({ error: "Provide threadId or conversationId" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
