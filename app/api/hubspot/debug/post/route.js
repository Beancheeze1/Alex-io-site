// app/api/hubspot/debug/post/route.js
import { NextResponse } from "next/server";

function token() {
  const t = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!t) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return t;
}

const HS = {
  headersJSON: () => ({
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
  }),
};

async function tryThread(threadId, text, type) {
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`;
  const payload = { type, text, sender: { type: "BOT", name: "ALEX-IO" } };
  const r = await fetch(url, { method: "POST", headers: HS.headersJSON(), body: JSON.stringify(payload) });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body, url, payload };
}

async function getConversationId(threadId) {
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch {}
  return { ok: r.ok, status: r.status, body: txt, id: json?.conversation?.id ?? null };
}

async function tryConversation(conversationId, text, type) {
  const url = `https://api.hubapi.com/conversations/v3/conversations/${conversationId}/messages`;
  const payload = { type, text, sender: { type: "BOT", name: "ALEX-IO" } };
  const r = await fetch(url, { method: "POST", headers: HS.headersJSON(), body: JSON.stringify(payload) });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body, url, payload };
}

export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/debug/post" }, { status: 200 });
}

export async function POST(req) {
  try {
    const { threadId, text = "ALEX-IO debug ✅", messageType = "COMMENT" } = await req.json();
    if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });

    // 1) Try posting as COMMENT (minimal, inbox-only)
    const a = await tryThread(threadId, text, messageType); // messageType now defaults to "COMMENT"
    if (a.ok) return NextResponse.json({ ok: true, via: "thread", a }, { status: 200 });

    // ...leave the rest as-is


    // 2) Resolve conversation and try conversation endpoint
    const conv = await getConversationId(threadId);
    if (!conv.ok || !conv.id) {
      return NextResponse.json({ ok: false, via: "thread", a, resolve: conv }, { status: 200 });
    }

    const b = await tryConversation(conv.id, text, messageType);
    return NextResponse.json({ ok: b.ok, via: "conversation", a, resolve: conv, b }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
