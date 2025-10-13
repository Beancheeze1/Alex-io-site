import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const HS_BASE = "https://api.hubapi.com";
const HS_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const ALLOWED_CHANNEL_ID = process.env.HUBSPOT_ALLOWED_CHANNEL_ID || ""; // optional
const DEDUPE_TTL_SECONDS = 60 * 10; // de-dupe window (10 minutes)

// Upstash Redis (already working from your /api/redis-check)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,

  const url = `https://api.hubapi.com/conversations/v3/conversations/${conversationId}/messages`;
await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    type: "MESSAGE",
    text: "Thanks for your message — we’ll be in touch soon!"
  })

});

// ---- Helpers ---------------------------------------------------------------

async function hs(path: string, init?: RequestInit) {
  const res = await fetch(`${HS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${HS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HS ${res.status} ${res.statusText} for ${path} :: ${text}`);
  }
  return res;
}

/** Get thread details (contains channelId & inboxId) */
async function getThread(threadId: string) {
  const res = await hs(`/conversations/v3/conversations/threads/${threadId}`);
  return res.json() as Promise<{
    id: string;
    channelId?: string;
    inboxId?: string;
  }>;
}

/** Post an internal COMMENT on a thread */
async function postInternalComment(threadId: string, text: string) {
  const body = {
    type: "COMMENT",
    text,
  };
  const res = await hs(
    `/conversations/v3/conversations/threads/${threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return res.json();
}

/** Idempotency using messageId; returns true if this event is new */
async function markOnce(messageId: string) {
  const key = `hs:dedupe:${messageId}`;
  // NX means "only set if not exists" -> returns "OK" when it was new
  const ok = await redis.set(key, "1", { nx: true, ex: DEDUPE_TTL_SECONDS });
  return ok === "OK";
}

// ---- Route config (Next.js App Router) ------------------------------------
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// HubSpot webhooks send POST with an array of events
export async function POST(req: Request) {
  try {
    const events = (await req.json()) as Array<{
      subscriptionType: string;            // e.g., conversation.newMessage
      objectId: number;                    // threadId
      messageId: string;                   // messageId in the thread
      messageType: "MESSAGE" | "COMMENT";  // MESSAGE = visitor/email, COMMENT = internal
      changeFlag: "NEW_MESSAGE" | string;
      portalId: number;
      appId: number;
    }>;

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, note: "no events" }, { status: 200 });
    }

    // process each event independently but quickly acknowledge overall
    // (HubSpot only needs a 2xx; we’ll do minimal work per event)
    const tasks = events.map(async (ev) => {
      // Only react to *new* inbound messages (not internal comments)
      if (
        ev.subscriptionType !== "conversation.newMessage" ||
        ev.messageType !== "MESSAGE" ||
        ev.changeFlag !== "NEW_MESSAGE"
      ) {
        return;
      }

      // idempotency: if we've seen this messageId, skip
      const isNew = await markOnce(ev.messageId);
      if (!isNew) return;

      const threadId = String(ev.objectId);

      // (Optional) filter to a specific channelId if you set HUBSPOT_ALLOWED_CHANNEL_ID
      if (ALLOWED_CHANNEL_ID) {
        try {
          const t = await getThread(threadId);
          if (t?.channelId && t.channelId !== ALLOWED_CHANNEL_ID) {
            return; // wrong channel; ignore
          }
        } catch (e) {
          // If we can't fetch thread meta, fail soft so HubSpot doesn't retry forever
          console.error("[webhook:getThread:error]", String(e));
          return;
        }
      }

      // Compose your internal note (adjust message as you like)
      const note =
        "✅ Bot is active. This thread is being handled automatically. " +
        "If you need to override, reply here and the bot will pause.";

      try {
        await postInternalComment(threadId, note);
      } catch (e) {
        console.error("[webhook:postComment:error]", String(e));
      }
    });

    // Fire & forget (we don’t need to await all to 200)
    await Promise.allSettled(tasks);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook:error]", err);
    // Always return 200 to avoid HubSpot flood-retrying; we handle dedupe internally
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

