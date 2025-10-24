import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const HUBSPOT_APP_ID = process.env.HUBSPOT_APP_ID || "21751024"; // fallback to your appId

type ThreadMeta = {
  channelId: string;
  channelAccountId: string;
};

// helper to call HubSpot API with active token
async function hsFetch(path: string, init?: RequestInit) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  const url = `https://api.hubapi.com${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  return { resp, ok: resp.ok, status: resp.status };
}

// meta extract helper
function pickChannelMeta(obj: any): Partial<ThreadMeta> {
  if (!obj) return {};
  const cId =
    obj.channelId ??
    obj.channel_id ??
    obj.channel?.id ??
    obj.properties?.channelId ??
    obj.thread?.channelId ??
    obj.message?.channelId ??
    null;
  const cAcc =
    obj.channelAccountId ??
    obj.channel_account_id ??
    obj.channel?.accountId ??
    obj.properties?.channelAccountId ??
    obj.thread?.channelAccountId ??
    obj.message?.channelAccountId ??
    null;
  return {
    channelId: cId ? String(cId) : undefined,
    channelAccountId: cAcc ? String(cAcc) : undefined,
  };
}

// smarter lookup
async function getThreadChannelMeta(
  threadId: string,
  messageId?: string
): Promise<ThreadMeta | null> {
  // 1) try message detail
  if (messageId) {
    const { resp } = await hsFetch(
      `/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`
    );
    if (resp?.ok) {
      const j = await resp.json().catch(() => null);
      const meta = pickChannelMeta(j);
      if (meta.channelId && meta.channelAccountId) return meta as ThreadMeta;
    }
  }

  // 2) try thread messages list
  {
    const { resp } = await hsFetch(
      `/conversations/v3/conversations/threads/${encodeURIComponent(
        threadId
      )}/messages?limit=50`
    );
    if (resp?.ok) {
      const j = await resp.json().catch(() => null);
      const arr: any[] = Array.isArray(j?.results)
        ? j.results
        : Array.isArray(j)
        ? j
        : [];
      for (const m of arr) {
        const meta = pickChannelMeta(m);
        if (meta.channelId && meta.channelAccountId) return meta as ThreadMeta;
      }
    }
  }

  // 3) try thread object itself
  {
    const { resp } = await hsFetch(
      `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`
    );
    if (resp?.ok) {
      const j = await resp.json().catch(() => null);
      const meta = pickChannelMeta(j);
      if (meta.channelId && meta.channelAccountId) return meta as ThreadMeta;
    }
  }

  return null;
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { text } = await req.json().catch(() => ({}));
    if (!text)
      return NextResponse.json({
        ok: false,
        step: "validate",
        error: "Missing text",
      });

    // get last webhook from Redis
    const last = (await redis.get("lastWebhook")) as any;
    if (!last || !last[0])
      return NextResponse.json({
        ok: false,
        step: "loadLastWebhook",
        error: "No last webhook found",
      });

    const wh = Array.isArray(last) ? last[0] : last;
    const threadId = String(wh.objectId || wh.threadId || wh.conversationId);
    const messageId = String(wh.messageId || "");

    // lookup meta
    const meta = await getThreadChannelMeta(threadId, messageId);
    if (!meta)
      return NextResponse.json({
        ok: false,
        step: "getThreadChannelMeta",
        error: "Missing channelId/channelAccountId",
        meta: {},
      });

    // construct actorId properly
    const actorId = `APP-${HUBSPOT_APP_ID}`;

    const body = {
      type: "MESSAGE",
      text,
      senderActorId: actorId,
      channelId: meta.channelId,
      channelAccountId: meta.channelAccountId,
    };

    const { resp, status } = await hsFetch(
      `/conversations/v3/conversations/threads/${threadId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    const json = await resp.json().catch(() => ({}));

    return NextResponse.json({
      ok: resp.ok,
      status,
      step: "postReply",
      threadId,
      meta,
      reply: json,
      error: resp.ok ? undefined : JSON.stringify(json),
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      step: "catch",
      error: String(err?.message || err),
    });
  }
}
