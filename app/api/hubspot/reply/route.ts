// app/api/hubspot/reply/route.ts
import { NextResponse } from "next/server";

/** ===== Upstash helpers ===== */
async function kvGet(key: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const j = await r.json().catch(() => null);
  if (!j?.result) return null;
  try { return JSON.parse(j.result); } catch { return j.result; }
}

async function kvSet(key: string, value: any) {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  await fetch(
    `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).catch(() => {});
}

/** ===== Token manager (access + refresh) ===== */
type TokenBundle = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

async function refreshIfNeeded(resp: Response, last: TokenBundle): Promise<TokenBundle | null> {
  if (resp.status !== 401) return null;
  const clientId = process.env.HUBSPOT_CLIENT_ID!;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET!;
  if (!clientId || !clientSecret || !last?.refresh_token) return null;

  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("refresh_token", last.refresh_token);

  const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });
  if (!r.ok) return null;
  const next = (await r.json()) as TokenBundle;
  const merged: TokenBundle = { ...last, ...next };
  await kvSet("hubspot:tokens", merged);
  return merged;
}

async function hsFetch(path: string, init: RequestInit = {}, tokens?: TokenBundle) {
  const withAuth = async (t: TokenBundle) =>
    fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${t.access_token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      cache: "no-store",
    });

  const current: TokenBundle = tokens ?? (await kvGet("hubspot:tokens"));
  if (!current?.access_token) {
    return { resp: null as Response | null, tokens: current, error: "No access token" as const };
  }
  let resp = await withAuth(current);
  if (resp.status === 401) {
    const fresh = await refreshIfNeeded(resp, current);
    if (fresh) {
      resp = await withAuth(fresh);
      return { resp, tokens: fresh, error: null as any };
    }
  }
  return { resp, tokens: current, error: null as any };
}

/** ===== Resolve thread/message ===== */
async function getThreadIdFromMessage(messageId: string): Promise<string | null> {
  const { resp } = await hsFetch(`/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`);
  if (!resp?.ok) return null;
  const j = await resp.json().catch(() => null);
  const threadId = j?.threadId ?? j?.thread?.id ?? j?.threadID ?? j?.thread_id ?? null;
  return threadId ? String(threadId) : null;
}

async function getThreadIdFromObject(objectId: string | number): Promise<string | null> {
  // Frequently objectId is already the threadId for conversation.newMessage
  const id = String(objectId);
  const { resp } = await hsFetch(`/conversations/v3/conversations/threads/${encodeURIComponent(id)}`);
  if (resp?.ok) return id;
  return null;
}

/** ===== Load channel info from thread ===== */
type ThreadMeta = { channelId?: string; channelAccountId?: string };

async function getThreadChannelMeta(threadId: string): Promise<ThreadMeta | null> {
  const { resp } = await hsFetch(`/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`);
  if (!resp?.ok) return null;
  const j = await resp.json().catch(() => null);
  // The properties vary by account; try the common places:
  const channelId =
    j?.channelId ?? j?.channel?.id ?? j?.thread?.channelId ?? j?.properties?.channelId ?? null;
  const channelAccountId =
    j?.channelAccountId ?? j?.channel?.accountId ?? j?.thread?.channelAccountId ?? j?.properties?.channelAccountId ?? null;
  return { channelId: channelId ? String(channelId) : undefined,
           channelAccountId: channelAccountId ? String(channelAccountId) : undefined };
}

/** ===== Post a reply into a thread ===== */
async function postReply(threadId: string, text: string, senderActorId: string, channelId: string, channelAccountId: string) {
  const body = {
    type: "MESSAGE",
    messageFormat: "TEXT",
    text,
    direction: "OUTGOING",
    senderActorId,
    senderActorType: "APP",
    channelId,
    channelAccountId,
  };

  const { resp } = await hsFetch(
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    { method: "POST", body: JSON.stringify(body) }
  );

  if (!resp) return { ok: false, status: 0, error: "No response" as const };
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: t || `HTTP ${resp.status}` };
  }
  const j = await resp.json().catch(() => ({}));
  return { ok: true, status: 200, data: j };
}

/** ===== Read last webhook ===== */
async function getLastWebhook() {
  return (await kvGet("hubspot:last-webhook")) as any;
}

export const dynamic = "force-dynamic";

/**
 * POST /api/hubspot/reply
 * Body (optional): { text: string }
 * Uses the most recent webhook to determine the target thread and replies.
 */
export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const messageText = text?.trim() || "Thanks for your message! This is an automated reply from alex-io 🤖";

  const tokens = (await kvGet("hubspot:tokens")) as TokenBundle | null;
  if (!tokens?.access_token) {
    return NextResponse.json(
      { ok: false, error: "No HubSpot access token persisted. Re-run /api/auth/hubspot." },
      { status: 400 }
    );
  }

  const last = await getLastWebhook();
  if (!Array.isArray(last) || last.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No lastWebhook found. Trigger an inbound message or send a test event first." },
      { status: 400 }
    );
  }
  const evt = last[0];

  // Resolve threadId
  const messageId: string | null =
    evt?.messageId ?? evt?.properties?.messageId ?? null;
  const objectId: string | number | null =
    evt?.objectId ?? evt?.properties?.threadId ?? null;

  let threadId: string | null = null;
  if (messageId) threadId = await getThreadIdFromMessage(messageId);
  if (!threadId && objectId != null) threadId = await getThreadIdFromObject(objectId);
  if (!threadId) {
    return NextResponse.json(
      { ok: false, error: "Could not resolve threadId", hint: { messageId, objectId, subscriptionType: evt?.subscriptionType } },
      { status: 422 }
    );
  }

  // Load channel info
  const meta = await getThreadChannelMeta(threadId);
  if (!meta?.channelId || !meta?.channelAccountId) {
    return NextResponse.json(
      { ok: false, step: "getThreadChannelMeta", error: "Missing channelId/channelAccountId", meta },
      { status: 400 }
    );
  }

  // Determine senderActorId
  const senderActorId =
    process.env.HUBSPOT_APP_ID ||
    (evt?.appId ? String(evt.appId) : "");

  if (!senderActorId) {
    return NextResponse.json(
      { ok: false, error: "Missing HUBSPOT_APP_ID and webhook had no appId. Set HUBSPOT_APP_ID env to your HubSpot App ID." },
      { status: 400 }
    );
  }

  const posted = await postReply(threadId, messageText, senderActorId, meta.channelId, meta.channelAccountId);
  if (!posted.ok) {
    return NextResponse.json(
      { ok: false, step: "postReply", status: posted.status, error: posted.error, threadId, meta },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, threadId, meta, reply: posted.data });
}

/** GET helper: returns what we would reply to (dry run) */
export async function GET() {
  const last = await getLastWebhook();
  return NextResponse.json({ ok: true, lastWebhook: last });
}
