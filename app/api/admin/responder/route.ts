// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS_BASE = "https://api.hubapi.com";

function tryJson(x: string) { try { return JSON.parse(x); } catch { return x; } }

/**
 * NEW: Token resolver
 * - Uses HS_TOKEN env if present
 * - Falls back to KV key "hs:oauth:access_token" if available
 */
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

export async function POST(req: Request) {
  // tolerant body parsing
  const raw = await req.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch {}
  const threadId =
    data.threadId ?? data.threadID ?? data.thread_id ?? data?.ev?.objectId;
  const text = data.text;

  if (!threadId) {
    return NextResponse.json(
      { ok: false, error: "missing-threadId", raw: raw?.slice?.(0, 200) ?? "<no-body>" },
      { status: 400 }
    );
  }

  // ⬇⬇⬇ EXACTLY HERE: this line replaces the old `const token = process.env.HS_TOKEN;`
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing-HS_TOKEN" }, { status: 400 });
  }
  // ⬆⬆⬆

  const senderActorId = process.env.SENDER_ACTOR_ID; // e.g., "A-123456"
  if (!senderActorId) {
    return NextResponse.json({ ok: false, error: "missing-SENDER_ACTOR_ID" }, { status: 400 });
  }

  // -------- 1) Try to get latest message (preferred) --------
  const msgsUrl = `${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`;
  let channelId: any;
  let channelAccountId: any;
  let recipients: any[] = [];

  const msgsRes = await fetch(msgsUrl, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  const msgsText = await msgsRes.text();

  if (msgsRes.ok) {
    const msgs = tryJson(msgsText) as any;
    const results = Array.isArray(msgs?.results) ? msgs.results : msgs?.results ?? [];
    const last = results[results.length - 1] ?? results[0];
    if (last) {
      channelId = last.channelId ?? last?.client?.channelId ?? last?.originalChannelId;
      channelAccountId = last.channelAccountId ?? last?.client?.channelAccountId ?? last?.originalChannelAccountId;
      recipients = Array.isArray(last.recipients) ? last.recipients : [];
    }
  } else {
    // -------- 2) Fallback: get thread details for channel info --------
    const threadUrl = `${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`;
    const tRes = await fetch(threadUrl, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    const tText = await tRes.text();

    if (!tRes.ok) {
      return NextResponse.json(
        { ok: false, step: "fetch-thread", status: tRes.status, body: tryJson(tText) },
        { status: 502 }
      );
    }

    const t = tryJson(tText) as any;
    channelId = t?.channelId ?? t?.channel?.id ?? t?.client?.channelId;
    channelAccountId = t?.channelAccountId ?? t?.channel?.accountId ?? t?.client?.channelAccountId;
    recipients = Array.isArray(t?.recipients) ? t.recipients : [];
  }

  if (!channelId || !channelAccountId) {
    return NextResponse.json(
      { ok: false, error: "missing-channel-info", channelId, channelAccountId },
      { status: 400 }
    );
  }

  // -------- 3) Send reply --------
  const endpoint = `${HS_BASE}/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`;
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
  return NextResponse.json({ ok: r.ok, status: r.status, body: tryJson(bodyText), sent: payload });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "POST { threadId, text? } with HS_TOKEN (or KV) + SENDER_ACTOR_ID set. Copies channel fields from last message or thread details."
  });
}
