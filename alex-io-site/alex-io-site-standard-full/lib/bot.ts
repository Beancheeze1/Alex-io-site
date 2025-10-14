// lib/bot.ts
import crypto from "node:crypto";
import { getMessageById, getThreadById, sendChatReply, sendEmailReply } from "./hubspot";
import { kv, seen, mark } from "./kv";

const APP_ID = process.env.HUBSPOT_APP_ID || "0";

export type HSWebhook = {
  eventId: number | string;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string; // "conversation.newMessage"
  attemptNumber: number;
  objectId: string; // threadId
  messageId?: string;
  messageType?: string; // "MESSAGE"
  changeFlag?: string; // "NEW_MESSAGE"
};

function hash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export async function processWebhookEvent(e: HSWebhook) {
  const threadId = String(e.objectId);
  const eventKey = `evt:${e.eventId}`;
  const msgId = e.messageId ? String(e.messageId) : null;

  // 1) Idempotency at event level (48h)
  if (await seen(eventKey)) return { skipped: "duplicate-event" };
  await mark(eventKey, 48 * 3600);

  // Only act on NEW_MESSAGE of type MESSAGE
  if (e.changeFlag !== "NEW_MESSAGE" || e.messageType !== "MESSAGE") {
    return { skipped: "not-a-new-message" };
  }

  // 2) Message-level idempotency (14 days)
  if (msgId && await seen(`msg:${msgId}`)) return { skipped: "duplicate-message" };

  // 3) Fetch the message to detect sender (filter out ourselves)
  const msg = msgId ? await getMessageById(msgId) : null;

  if (msg) {
    const senderAppId = String(msg?.sender?.appId ?? "");
    const senderType = String(msg?.sender?.type ?? "");
    // Skip if it's us or a bot/agent/system
    if (senderAppId && senderAppId === String(APP_ID)) {
      return { skipped: "from-our-app" };
    }
    if (["BOT", "AGENT", "SYSTEM"].includes(senderType.toUpperCase())) {
      return { skipped: `from-${senderType}` };
    }
  }

  // 4) Fetch thread to learn channel
  const thread = await getThreadById(threadId);
  const channelType = String(thread?.channelType ?? "").toUpperCase(); // e.g., EMAIL, MESSAGING/CHAT, etc.

  if (!channelType) {
    return { error: "no-channel", threadPreview: thread };
  }

  // 5) Compose your reply (you can swap with your real logic)
  const replyBody = composeAutoReply(thread, msg);

  // 6) Per-thread payload hash guard (2h) to avoid accidental double-sends
  const payloadHash = hash(`${threadId}:${normalize(replyBody)}`);
  const lastHash = await kv.get(`last:${threadId}`);
  if (lastHash === payloadHash) {
    return { skipped: "same-payload-recently-sent" };
  }

  // 7) Send based on channel
  let sendResult: any;
  if (channelType === "EMAIL") {
    sendResult = await sendEmailReply(threadId, replyBody);
  } else {
    // Treat everything else as chat/messaging
    sendResult = await sendChatReply(threadId, replyBody);
  }

  // 8) Mark sent for this message to block any retried webhooks
  if (msgId) await mark(`msg:${msgId}`, 30 * 24 * 3600);
  await kv.set(`last:${threadId}`, payloadHash, { ex: 2 * 3600 });

  return { ok: true, channelType, sendResult };
}

/** Super simple auto-reply while you test. Replace with your real generator. */
function composeAutoReply(thread: any, msg: any) {
  const who = msg?.sender?.name || "there";
  return `Hi ${who}, thanks for reaching out! We received your message and will follow up shortly.`;
}
