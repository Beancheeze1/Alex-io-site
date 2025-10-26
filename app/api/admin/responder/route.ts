// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS_BASE = "https://api.hubapi.com";

function tryJson(x: string) { try { return JSON.parse(x); } catch { return x; } }

// Resolve token: env first, then KV key "hs:oauth:access_token"
async function getToken(): Promise<string | null> {
  if (process.env.HS_TOKEN) return process.env.HS_TOKEN;
  try {
    const mod: any = await import("@/lib/kv");
    const kv = mod?.kv ?? mod?.default ?? mod?.redis ?? mod?.client ?? null;
    if (kv?.get) {
      const token = await kv.get("hs:oauth:access_token");
      if (typeof token === "string" && token.length > 0) return token;
    }
  } catch {}
  return null;
}

// GET helper with Bearer header
async function hsGet(url: string, token: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: tryJson(t) };
}

export async function POST(req: Request) {
  // tolerant body parsing
  const raw = await req.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch {}
  const inputId = data.threadId ?? data.threadID ?? data.thread_id ?? data?.ev?.objectId;
  const text = data.text;

  if (!inputId) {
    return NextResponse.json(
      { ok: false, error: "missing-threadId", raw: raw?.slice?.(0, 200) ?? "<no-body>" },
      { status: 400 }
    );
  }

  const token = await getToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing-HS_TOKEN" }, { status: 400 });
  }

  const senderActorId = process.env.SENDER_ACTOR_ID; // e.g., "A-123456"
  if (!senderActorId) {
    return NextResponse.json({ ok: false, error: "missing-SENDER_ACTOR_ID" }, { status: 400 });
  }

  // -------- Resolve: threadId vs conversationId --------
  let resolvedThreadId = String(inputId);

  // If treating as thread returns 404, try listing by conversationId
  {
    const test = await hsGet(`${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(resolvedThreadId)}`, token);
    if (!test.ok && test.status === 404) {
      const list = await hsGet(`${HS_BASE}/conversations/v3/conversations/threads?conversationId=${encodeURIComponent(String(inputId))}`, token);
      if (list.ok && Array.isArray((list.body as any)?.results) && (list.body as any).results.length > 0) {
        const first = (list.body as any).results[0];
        resolvedThreadId = String(first.id ?? first.threadId);
      } else {
        return NextResponse.json(
          { ok: false, step: "resolve-thread", status: list.status, body: list.body },
          { status: 404 }
        );
      }
    } else if (!test.ok && test.status !== 404) {
      return NextResponse.json(
        { ok: false, step: "check-thread", status: test.status, body: test.body },
        { status: 502 }
      );
    }
  }

  // -------- Get last message (preferred) or thread details --------
  let channelId: any;
  let channelAccountId: any;
  let recipients: any[] = [];

  const msgs = await hsGet(`${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(resolvedThreadId)}/messages`, token);

  if (msgs.ok) {
    const results = Array.isArray((msgs.body as any)?.results) ? (msgs.body as any).results : (msgs.body as any)?.results ?? [];
    const last = results[results.length - 1] ?? results[0];
    if (last) {
      channelId = last.channelId ?? last?.client?.channelId ?? last?.originalChannelId;
      channelAccountId = last.channelAccountId ?? last?.client?.channelAccountId ?? last?.originalChannelAccountId;
      recipients = Array.isArray(last.recipients) ? last.recipients : [];
    }
  } else {
    const t = await hsGet(`${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(resolvedThreadId)}`, token);
    if (!t.ok) {
      return NextResponse.json(
        { ok: false, step: "fetch-thread", status: t.status, body: t.body },
        { status: 502 }
      );
    }
    const tb = t.body as any;
    channelId = tb?.channelId ?? tb?.channel?.id ?? tb?.client?.channelId;
    channelAccountId = tb?.channelAccountId ?? tb?.channel?.accountId ?? tb?.client?.channelAccountId;
    recipients = Array.isArray(tb?.recipients) ? tb.recipients : [];
  }

  if (!channelId || !channelAccountId) {
    return NextResponse.json(
      { ok: false, error: "missing-channel-info", channelId, channelAccountId, threadId: resolvedThreadId },
      { status: 400 }
    );
  }

  // -------- Send reply --------
  const endpoint = `${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(resolvedThreadId)}/messages`;
  const payload = {
    type: "MESSAGE",
    text: text ?? `Alex-IO test responder ✅ ${new Date().toISOString()}`,
    senderActorId,
    channelId,
    channelAccountId,
    recipients,
    attachments: [],
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
  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    body: tryJson(bodyText),
    sent: { ...payload, threadId: resolvedThreadId }
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "POST { threadId, text? } with HS_TOKEN (or KV) + SENDER_ACTOR_ID. Accepts threadId or conversationId; resolves automatically."
  });
}
