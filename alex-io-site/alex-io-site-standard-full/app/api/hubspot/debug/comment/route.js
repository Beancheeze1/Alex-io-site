// app/api/hubspot/debug/comment/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getThreadById, sendEmailReply, sendChatReply } from "../../../../../lib/hubspot.js";

export async function POST(req) {
  try {
    const { threadId, text } = await req.json();
    if (!threadId || !text) {
      return NextResponse.json({ error: "threadId and text required" }, { status: 400 });
    }

    const t = await getThreadById(threadId);
    const channelType = String(t?.channelType ?? "").toUpperCase();

    if (!channelType) {
      return NextResponse.json({ error: "no channelType on thread", threadPreview: t }, { status: 400 });
    }

    const result = channelType === "EMAIL"
      ? await sendEmailReply(threadId, text)
      : await sendChatReply(threadId, text);

    return NextResponse.json({ ok: true, channelType, result });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
