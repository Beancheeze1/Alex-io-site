import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/* ============ Upstash ============ */
const redis = Redis.fromEnv();

async function kvGet<T = any>(key: string): Promise<T | null> {
  const v = (await redis.get(key)) as any;
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { /* ignore */ }
  }
  return v as T;
}
async function kvSet(key: string, value: any) {
  await redis.set(key, JSON.stringify(value));
}

/* ============ Tokens (access + refresh) ============ */
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

  const current: TokenBundle | null = tokens ?? (await kvGet<TokenBundle>("hubspot:tokens"));
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

/* ============ Resolve thread/message ============ */
async function getThreadIdFromMessage(messageId: string): Promise<string | null> {
  const { resp } = await hsFetch(`/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`);
  if (!resp?.ok) return null;
  const j = await resp.json().catch(() => null);
  const threadId = j?.threadId ?? j?.thread?.id ?? j?.threadID ?? j?.thread_id ?? null;
  return threadId ? String(threadId) : null;
}

async function getThreadIdFromObject(objectId: string | number): Promise<string | null> {
  const id = String(objectId);
  const { resp } = await hsFetch(`/conversations/v3/conversations/threads/${encodeURIComponent(id)}`);
  if (resp?.ok) return id;
  return null;
}

/* ============ Channel meta helpers ============ */
type ThreadMeta = { channelId?: string; channelAccountId?: string };

function pickChannelMeta(obj: any): ThreadMeta {
  if (!obj || typeof obj !== "object") return {};
  const channelId =
    obj.channelId ??
    obj.channel_id ??
    obj.channel?.id ??
    obj.thread?.channelId ??
    obj.properties?.channelId ??
    obj.properties?.channel_id ??
    obj.message?.channelId ??
    obj.message?.channel?.id ??
    null;

  const channelAccountId =
    obj.channelAccountId ??
    obj.channel_account_id ??
    obj.channel?.accountId ??
    obj.thread?.channelAccountId ??
    obj.properties?.channelAccountId ??
    obj.properties?.channel_account_id ??
    obj.message?.channelAccountId ??
    obj.message?.channel?.accountId ??
    null;

  return {
    channelId: channelId ? String(channelId) : undefined,
    channelAccountId: channelAccountId ? String(channelAccountId) : undefined,
  };
}

/** Try: message → thread messages list → thread */
async function getThreadChannelMeta(threadId: string, messageId?: string): Promise<Required<ThreadMeta> | null> {
  // 1) message detail
  if (messageId) {
    const { resp } = await hsFetch(`/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`);
    if (resp?.ok) {
      const j = await resp.json().catch(() => null);
      const meta = pickChannelMeta(j);
      if (meta.channelId && meta.channelAccountId) return meta as Required<ThreadMeta>;
    }
  }
  // 2) list thread messages
  {
    const { resp } = await hsFetch(`/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages?limit=50`);
    if (resp?.ok) {
      const j = await resp.json().catch(() => null);
      const arr: any[] = Array.isArray(j?.results) ? j.results : Array.isArray(j) ? j : [];
      for (const m of arr) {
        const meta = pickChannelMeta(m);
        if (meta.channelId && meta.channelAccountId) return meta as Required<ThreadMeta>;
      }
    }
  }
  // 3) thread object
  {
    const { resp } = await hsFetch(`/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`);
    if (resp?.ok) {
      const j = await resp.json().catch(() => null);
      const meta = pickChannelMeta(j);
      if (meta.channelId && meta.channelAccountId) return meta as Required<ThreadMeta>;
    }
  }
  return null;
}

/* ============ Participants ============ */
// We’ll discover valid sender/recipient actorIds in the thread.
type Participant = { actorId?: string; role?: string; type?: string; [k: string]: any };

async function listParticipants(threadId: string): Promise<Participant[]> {
  const { resp } = await hsFetch(`/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/participants`);
  if (!resp?.ok) return [];
  const j = await resp.json().catch(() => null);
  const arr: Participant[] = Array.isArray(j?.results) ? j.results : Array.isArray(j) ? j : [];
  return arr;
}

function selectActors(participants: Participant[]) {
  // Heuristics:
  // - consumer/visitor: recipient
  // - hubspot_user/agent: preferred sender
  // - app/integration: optional sender fallback if present in participants
  let recipient: string | undefined;
  let sender: string | undefined;

  for (const p of participants) {
    const id = p.actorId || p.actor?.id || p.id;
    const role = (p.role || p.participantRole || "").toString().toUpperCase();
    const type = (p.type || p.participantType || "").toString().toUpperCase();

    if (!recipient && (role.includes("CONSUMER") || role.includes("VISITOR") || type.includes("CONSUMER") || type.includes("VISITOR"))) {
      recipient = String(id);
    }
    if (!sender && (role.includes("AGENT") || role.includes("HUBSPOT_USER") || type.includes("AGENT") || type.includes("HUBSPOT_USER"))) {
      sender = String(id);
    }
  }

  // If we still don't have a sender, try any other non-consumer participant
  if (!sender) {
    const alt = participants.find(p => {
      const id = p.actorId || p.actor?.id || p.id;
      const role = (p.role || p.participantRole || "").toString().toUpperCase();
      return id && !role.includes("CONSUMER") && !role.includes("VISITOR");
    });
    if (alt?.actorId) sender = String(alt.actorId);
  }

  return { senderActorId: sender, recipientActorId: recipient };
}

/* ============ Post reply ============ */
async function postReply(
  threadId: string,
  messageText: string,
  meta: Required<ThreadMeta>,
  senderActorId?: string,
  recipientActorId?: string
) {
  // Build payload. HubSpot requires at least one recipient; include when we have it.
  const body: any = {
    type: "MESSAGE",
    messageFormat: "TEXT",
    text: messageText,
    direction: "OUTGOING",
    channelId: meta.channelId,
    channelAccountId: meta.channelAccountId,
  };

  if (senderActorId) body.senderActorId = senderActorId;
  if (recipientActorId) body.recipients = [{ actorId: recipientActorId }];

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
  return { ok: true, status: 200, data: j, payload: body };
}

/* ============ Routes ============ */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const reqBody = (await req.json().catch(() => ({}))) as any;
    const messageText: string =
      (typeof reqBody?.text === "string" ? reqBody.text.trim() : "") ||
      "Thanks for your message! This is an automated reply from alex-io 🤖";

    // tokens must exist
    const tokens = await kvGet<TokenBundle>("hubspot:tokens");
    if (!tokens?.access_token) {
      return NextResponse.json(
        { ok: false, error: "No HubSpot access token persisted. Re-run /api/auth/hubspot first." },
        { status: 400 }
      );
    }

    // load last webhook we stored in the webhook route
    const last = await kvGet<any>("hubspot:last-webhook");
    if (!Array.isArray(last) || !last[0]) {
      return NextResponse.json(
        { ok: false, step: "loadLastWebhook", error: "No last webhook found" },
        { status: 400 }
      );
    }
    const wh = last[0];

    // resolve thread
    const messageId: string | null = wh?.messageId ?? wh?.properties?.messageId ?? null;
    const objectId: string | number | null = wh?.objectId ?? wh?.properties?.threadId ?? null;

    let threadId: string | null = null;
    if (messageId) threadId = await getThreadIdFromMessage(messageId);
    if (!threadId && objectId != null) threadId = await getThreadIdFromObject(objectId);
    if (!threadId) {
      return NextResponse.json(
        { ok: false, error: "Could not resolve threadId", hint: { messageId, objectId, subscriptionType: wh?.subscriptionType } },
        { status: 422 }
      );
    }

    // channel meta
    const meta = await getThreadChannelMeta(threadId, messageId || undefined);
    if (!meta) {
      return NextResponse.json(
        { ok: false, step: "getThreadChannelMeta", error: "Missing channelId/channelAccountId", meta: {} },
        { status: 400 }
      );
    }

    // participants → choose sender & recipient
    const parts = await listParticipants(threadId);
    const { senderActorId, recipientActorId } = selectActors(parts);

    // Post reply (sender optional, recipient strongly recommended)
    const posted = await postReply(threadId, messageText, meta, senderActorId, recipientActorId);
    if (!posted.ok) {
      return NextResponse.json(
        { ok: false, step: "postReply", status: posted.status, error: posted.error, threadId, meta, participants: parts },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      threadId,
      meta,
      senderActorId,
      recipientActorId,
      reply: posted.data,
      payloadUsed: posted.payload,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, step: "catch", error: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET() {
  const last = await kvGet("hubspot:last-webhook");
  return NextResponse.json({ ok: true, lastWebhook: last });
}
