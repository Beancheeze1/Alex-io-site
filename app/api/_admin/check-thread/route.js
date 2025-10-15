// app/api/admin/check-thread/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getThreadById, getThreadMessages } from "../../../../lib/hubspot.js";

const pick = (...vals) => {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
};

export async function GET(req) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ error: "missing threadId" }, { status: 400 });

  try {
    const thread = await getThreadById(threadId);
    const msgsResp = await getThreadMessages(threadId, 50);

    const msgs =
      (Array.isArray(msgsResp?.results) && msgsResp.results) ||
      (Array.isArray(msgsResp?.items) && msgsResp.items) ||
      (Array.isArray(msgsResp?.messages) && msgsResp.messages) ||
      [];

    const last = msgs.length ? msgs[msgs.length - 1] : null;

    // sender/type inference based on the keys your payload exposes
    const lastSenderType = pick(
      last?.senders?.[0]?.type,        // common
      last?.sender?.type,              // alt shape
      last?.createdBy?.type,           // sometimes present
      last?.direction
        ? (String(last.direction).toUpperCase() === "INBOUND" ? "HUMAN" : "AGENT/BOT")
        : null
    );

    const lastSenderName = pick(
      last?.senders?.[0]?.name,
      last?.sender?.name,
      last?.createdBy?.name,
      last?.client?.name
    );

    const channelHint = pick(
      last?.channelId,
      last?.channelAccountId,
      thread?.originalChannelId,
      thread?.originalChannelAccountId
    );

    const conversationId = pick(thread?.conversationId, thread?.id);
    const status = pick(thread?.status, thread?.properties?.status);
    const inboxId = pick(thread?.inboxId, thread?.properties?.inboxId);

    return NextResponse.json({
      threadId,
      conversationId,
      status,
      inboxId,
      channelHint,
      messagesCount: msgs.length,
      lastMessageSenderType: lastSenderType,
      lastMessageSenderName: lastSenderName,
      observedThreadKeys: Object.keys(thread || []),
      observedLastMessageKeys: last ? Object.keys(last) : []
    });
  } catch (e) {
    return NextResponse.json(
      { error: "HUBSPOT_FETCH_FAILED", details: String(e?.message || e) },
      { status: 502 }
    );
  }
}
