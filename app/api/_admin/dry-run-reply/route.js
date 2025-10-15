// app/api/_admin/dry-run-reply/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getMessageById, getThreadById } from "../../../../../lib/hubspot.js";

function normalize(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");
  const messageId = searchParams.get("messageId");

  if (!threadId) return NextResponse.json({ error: "missing threadId" }, { status: 400 });
  if (!messageId) return NextResponse.json({ error: "missing messageId" }, { status: 400 });

  try {
    const msg = await getMessageById(messageId);
    const t = await getThreadById(threadId);

    const senderType = String(msg?.sender?.type ?? "").toUpperCase();
    const channelType = String(t?.channelType ?? "").toUpperCase();

    const replyBody = `Hi ${msg?.sender?.name || "there"}, this is a DRY RUN.`;
    const payloadKey = `dry:${threadId}:${normalize(replyBody)}`;

    return NextResponse.json({
      ok: true,
      wouldSend: Boolean(channelType),
      channelType,
      senderType,
      replyPreview: replyBody,
      payloadHashKey: payloadKey
    });
  } catch (e) {
    return NextResponse.json(
      { error: "DRY_RUN_FAILED", details: String(e && e.message || e) },
      { status: 502 }
    );
  }
}
