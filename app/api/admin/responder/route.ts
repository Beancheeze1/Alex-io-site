// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS_BASE = "https://api.hubapi.com";

export async function POST(req: Request) {
  const { threadId, text } = await req.json().catch(() => ({} as any));

  if (!threadId) {
    return NextResponse.json({ ok: false, error: "missing-threadId" }, { status: 400 });
  }

  const token = process.env.HS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing-HS_TOKEN" }, { status: 400 });
  }

  const senderActorId = process.env.SENDER_ACTOR_ID; // e.g., "A-123456"
  if (!senderActorId) {
    return NextResponse.json({ ok: false, error: "missing-SENDER_ACTOR_ID" }, { status: 400 });
  }

  // 1) Fetch the latest message to copy channel + recipients
  const getMsgsUrl = `${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(
    threadId
  )}/messages`;
  const msgsRes = await fetch(getMsgsUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const msgsText = await msgsRes.text();
  if (!msgsRes.ok) {
    return NextResponse.json(
      { ok: false, step: "fetch-messages", status: msgsRes.status, body: tryJson(msgsText) },
      { status: 502 }
    );
  }
  const msgs = tryJson(msgsText) as any;
  const messages = Array.isArray(msgs?.results) ? msgs.results : msgs?.results ?? [];
  const last = messages[messages.length - 1] ?? messages[0];
  if (!last) {
    return NextResponse.json({ ok: false, error: "no-messages-on-thread" }, { status: 400 });
  }

  // Docs: required fields include senderActorId, channelId, channelAccountId; recipients recommended from last message.
  // https://developers.hubspot.com/docs/api-reference/conversations-conversations-inbox-%26-messages-v3/public-message/post-conversations-v3-conversations-threads-threadId-messages
  const channelId = last.channelId ?? last?.client?.channelId ?? last?.originalChannelId;
  const channelAccountId = last.channelAccountId ?? last?.client?.channelAccountId ?? last?.originalChannelAccountId;
  const recipients = Array.isArray(last.recipients) ? last.recipients : [];

  if (!channelId || !channelAccountId) {
    return NextResponse.json(
      { ok: false, error: "missing-channel-info", lastSummary: { channelId, channelAccountId } },
      { status: 400 }
    );
  }

  // 2) Send the reply
  const endpoint = `${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(
    threadId
  )}/messages`;

  const payload = {
    type: "MESSAGE",
    text: text ?? `Alex-IO test responder ✅ ${new Date().toISOString()}`,
    senderActorId,       // required (Agent actor)
    channelId,           // required
    channelAccountId,    // required
    recipients,          // recommended/required depending on channel
    attachments: [],     // allowed; keep empty
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await r.text();
  return NextResponse.json({ ok: r.ok, status: r.status, body: tryJson(bodyText), sent: payload });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "POST { threadId, text? } with HS_TOKEN + SENDER_ACTOR_ID set.",
  });
}

function tryJson(x: string) {
  try { return JSON.parse(x); } catch { return x; }
}
