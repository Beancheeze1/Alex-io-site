// app/api/_admin/dry-run-reply/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getMessageById, getThreadById } from "@/lib/hubspot";
import { kv } from "@/lib/kv";

function normalize(s: string) { return s.replace(/\s+/g, " ").trim(); }

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  const messageId = req.nextUrl.searchParams.get("messageId");

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
      wouldSend: channelType ? true : false,
      channelType,
      senderType,
      replyPreview: replyBody,
      payloadHashKey: payloadKey,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "DRY_RUN_FAILED", details: e?.message || String(e) },
      { status: 502 }
    );
  }
}
