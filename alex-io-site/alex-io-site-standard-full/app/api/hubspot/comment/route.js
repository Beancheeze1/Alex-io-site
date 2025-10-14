// app/api/hubspot/comment/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getThreadById, sendEmailReply, sendChatReply } from "../../../../lib/hubspot.js";

export async function POST(req) {
  try {
    const { threadId, text } = await req.json();

    if (!threadId || !text) {
      return NextResponse.json({ error: "threadId and text are required" }, { status: 400 });
    }

    const thread = await getThreadById(threadId);
    const channelType = String(thread?.channelType ?? "").toUpperCase();

    if (!channelType) {
      return NextResponse.json({ error: "No channelType found on thread", threadPreview: thread }, { status: 400 });
    }

    const result =
      channelType === "EMAIL"
        ? await sendEmailReply(threadId, text)
        : await sendChatReply(threadId, text);

    return NextResponse.json({ ok: true, channelType, result });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
