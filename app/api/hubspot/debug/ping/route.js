import { NextResponse } from "next/server";

function token() {
  const t = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!t) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return t;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId");
    if (!threadId) {
      return NextResponse.json({ error: "Provide ?threadId=" }, { status: 400 });
    }

    const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    const text = await r.text();

    let json = null;
    try { json = JSON.parse(text); } catch {}

    return NextResponse.json({
      ok: r.ok,
      status: r.status,
      hadToken: true,
      threadId,
      sample: text.slice(0, 300),
      conversationId: json?.conversation?.id ?? null
    }, { status: r.ok ? 200 : r.status });
  } catch (e) {
    return NextResponse.json({ ok: false, hadToken: Boolean(process.env.HUBSPOT_ACCESS_TOKEN), error: String(e) }, { status: 500 });
  }
}

