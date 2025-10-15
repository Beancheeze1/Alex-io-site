// app/api/hubspot/debug/thread/route.js
import { NextResponse } from "next/server";

function authHeaders() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return { Authorization: `Bearer ${token}` };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId");
    if (!threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 });
    }

    const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`;
    const r = await fetch(url, { headers: authHeaders() });
    const bodyText = await r.text();

    let json = null;
    try { json = JSON.parse(bodyText); } catch { /* leave as text */ }

    return NextResponse.json({
      ok: r.ok,
      status: r.status,
      threadId,
      raw: r.ok ? undefined : bodyText,
      conversationId: json?.conversation?.id ?? null,
      summary: {
        hasConversationId: Boolean(json?.conversation?.id),
        channel: json?.channel ?? null,
        lastMessageType: json?.messages?.[json?.messages?.length - 1]?.type ?? null,
      }
    }, { status: r.ok ? 200 : r.status });
  } catch (e) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

