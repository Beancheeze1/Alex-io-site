// lib/bot.js
import crypto from "crypto";
import { getMessageById, getThreadById, sendChatReply, sendEmailReply } from "./hubspot.js";
import { kv, seen, mark } from "./kv.js";

const APP_ID = process.env.HUBSPOT_APP_ID || "0";

function hash(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}
function normalize(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export async function processWebhookEvent(e) {
  const threadId = String(e.objectId);
  const eventKey = `evt:${e.eventId}`;
  const msgId = e.messageId ? String(e.messageId) : null;

  // 1) event-level idempotency (48h)
  if (await seen(eventKey)) return { skipped: "duplicate-event" };
  await mark(eventKey, 48 * 3600);

  // only act on NEW_MESSAGE of type MESSAGE
  if (e.changeFlag !== "NEW_MESSAGE" || e.messageType !== "MESSAGE") {
    return { skipped: "not-a-new-message" };
  }

  // 2) message-level idempotency (14d)
  if (msgId && await seen(`msg:${msgId}`)) return { skipped: "duplicate-message" };

  // 3) fetch message to detect sender
  const msg = msgId ? await getMessageById(msgId) : null;
  if (msg) {
    const senderAppId = String(msg?.sender?.appId ?? "");
    const senderType = String(msg?.sender?.type ?? "");
    if (senderAppId && senderAppId === String(APP_ID)) {
      return { skipped: "from-our-app" };
    }
    if (["BOT", "AGENT", "SYSTEM"].includes(senderType.toUpperCase())) {
      return { skipped: `from-${senderType}` };
    }
  }

  // 4) fetch thread to know channel
  const thread = await getThreadById(threadId);
  const channelType = String(thread?.channelType ?? "").toUpperCase();
  if (!channelType) {
    return { error: "no-channel", threadPreview: thread };
  }

  // 5) compose reply (replace with your real generator later)
  const replyBody = composeAutoReply(thread, msg);

  // 6) per-thread payload hash guard (2h)
  const payloadHash = hash(`${threadId}:${normalize(replyBody)}`);
  const lastHash = await kv.get(`last:${threadId}`);
  if (lastHash === payloadHash) {
    return { skipped: "same-payload-recently-sent" };
  }

  // 7) send
  let sendResult;
  if (channelType === "EMAIL") {
    sendResult = await sendEmailReply(threadId, replyBody);
  } else {
    sendResult = await sendChatReply(threadId, replyBody);
  }

  // 8) mark sent + remember payload
  if (msgId) await mark(`msg:${msgId}`, 30 * 24 * 3600);
  await kv.set(`last:${threadId}`, payloadHash, { ex: 2 * 3600 });

  return { ok: true, channelType, sendResult };
}

function composeAutoReply(thread, msg) {
  const who = (msg && msg.sender && msg.sender.name) ? msg.sender.name : "there";
  return `Hi ${who}, thanks for reaching out! We received your message and will follow up shortly.`;
}
