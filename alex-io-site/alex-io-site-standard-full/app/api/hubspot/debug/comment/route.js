// app/api/hubspot/debug/comment/route.js
import { NextResponse } from "next/server";

function authHeaders() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function postToConversation(conversationId, text) {
  const url = `https://api.hubapi.com/conversations/v3/conversations/${conversationId}/messages`;
  const payload = {
    type: "MESSAGE",
    text,
    sender: { type: "BOT", name: "ALEX-IO" } // helps some setups
  };
  const r = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}

async function postToThread(threadId, text) {
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`;
  const payload = {
    type: "MESSAGE",
    text,
    sender: { type: "BOT", name: "ALEX-IO" }
  };
  const r = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}

export async function POST(req) {
  try {
    const { conversationId, threadId, text } = await req.json();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

    // Strategy 1: if conversationId is provided, try conversation endpoint first
    if (conversationId) {
      const a = await postToConversation(conversationId, text);
      if (a.ok) return NextResponse.json({ ok: true, via: "conversation", status: a.status, body: a.body });
      // fall back to thread if threadId also given
      if (threadId) {
        const b = await postToThread(threadId, text);
        return NextResponse.json({ ok: b.ok, via: "thread-fallback", firstStatus: a.status, status: b.status, firstBody: a.body, body: b.body }, { status: b.ok ? 200 : b.status });
      }
      return NextResponse.json({ ok: false, via: "conversation", status: a.status, body: a.body }, { status: a.status });
    }

    // Strategy 2: only threadId provided → post to thread, then done
    if (threadId) {
      const b = await postToThread(threadId, text);
      return NextResponse.json({ ok: b.ok, via: "thread", status: b.status, body: b.body }, { status: b.ok ? 200 : b.status });
    }

    return NextResponse.json({ error: "Provide conversationId or threadId" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

