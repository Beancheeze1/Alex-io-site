// lib/bot.js
export const runtime = "nodejs";
// lib/bot.js
import crypto from "crypto";
import { kvForTenant } from "./kv.js";
import { getMessageById, getThreadById, sendReply } from "./hubspot-tenant.js";
import { classifyIntent } from "./nlp.js";
import { handleQuote } from "./skills/quote.js";
import { handleMeeting } from "./skills/meeting.js";
import { handleInfo } from "./skills/info.js";

const COOLDOWN_SECONDS = 120;

export async function processWebhookEvent(e, ctx) {
  const { tenantId, cfg } = ctx;
  const token = cfg.env.HUBSPOT_ACCESS_TOKEN;
  const kv = kvForTenant(tenantId);

  const eventKey = `evt:${e.eventId}`;
  if (await kv.get(eventKey)) return { skipped: "duplicate-event" };
  await kv.set(eventKey, 1, { ex: 48 * 3600 });

  if (e.changeFlag !== "NEW_MESSAGE" || e.messageType !== "MESSAGE")
    return { skipped: "not-a-new-message" };

  const msgId = e.messageId ? String(e.messageId) : null;
  if (msgId && await kv.get(`msg:${msgId}`)) return { skipped: "duplicate-message" };

  const msg = msgId ? await getMessageById(msgId, token) : null;

  // ignore our own / bots / agents
  const senderAppId = String(msg?.sender?.appId ?? "");
  const senderType  = String(msg?.sender?.type ?? "");
  const ourAppId    = String(cfg.env.HUBSPOT_APP_ID || "");
  if (senderAppId && ourAppId && senderAppId === ourAppId) return { skipped: "from-our-app" };
  if (["BOT","AGENT","SYSTEM"].includes(senderType.toUpperCase())) return { skipped: `from-${senderType}` };

  const threadId = String(e.objectId);
  const text = msg?.text || msg?.richText || "";

  // intent
  const intent = await classifyIntent(text, cfg);

  // act
  let replyBody;
  if (intent === "quote" && cfg.features?.quotes) {
    replyBody = await handleQuote({ text, cfg });
  } else if (intent === "meeting" && cfg.features?.meetings) {
    replyBody = await handleMeeting({ text, cfg });
  } else if (intent === "info" && cfg.features?.infoLookup) {
    replyBody = await handleInfo({ text, cfg });
  } else {
    replyBody = `Thanks for reaching out—we'll follow up shortly.${cfg.brand?.signature ?? ""}`;
  }

  // cooldown (by payload hash)
  const payloadHash = hash(`${threadId}:${normalize(replyBody)}`);
  const lastHash = await kv.get(`last:${threadId}`);
  if (lastHash === payloadHash) return { skipped: "same-payload-recently-sent" };

  const res = await sendReply(threadId, replyBody, token);
  if (msgId) await kv.set(`msg:${msgId}`, 1, { ex: 30 * 24 * 3600 });
  await kv.set(`last:${threadId}`, payloadHash, { ex: COOLDOWN_SECONDS });

  return { ok: true, tenantId, intent, sendId: res?.id ?? null };
}

function hash(s){ return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0,16); }
function normalize(s){ return String(s||"").replace(/\s+/g," ").trim(); }


/* ... keep the inline KV from earlier ... */

export async function processWebhookEvent(e) {
  const threadId = String(e.objectId);
  const eventKey = `evt:${e.eventId}`;
  const msgId = e.messageId ? String(e.messageId) : null;

  if (await seen(eventKey)) return { skipped: "duplicate-event" };
  await mark(eventKey, 48 * 3600);

  if (e.changeFlag !== "NEW_MESSAGE" || e.messageType !== "MESSAGE") {
    return { skipped: "not-a-new-message" };
  }

  if (msgId && await seen(`msg:${msgId}`)) return { skipped: "duplicate-message" };

  const msg = msgId ? await getMessageById(msgId) : null;
  if (msg) {
    const senderAppId = String(msg?.sender?.appId ?? "");
    const senderType = String(msg?.sender?.type ?? "");
    if (senderAppId && senderAppId === String(process.env.HUBSPOT_APP_ID || "0")) {
      return { skipped: "from-our-app" };
    }
    if (["BOT","AGENT","SYSTEM"].includes(senderType.toUpperCase())) {
      return { skipped: `from-${senderType}` };
    }
  }

  // still fetch thread (status/inbox, and to be future-proof) but we won't need channelType
  const thread = await getThreadById(threadId);

  const replyBody = composeAutoReply(thread, msg);

  const payloadHash = hash(`${threadId}:${normalize(replyBody)}`);
  const lastHash = await kv.get(`last:${threadId}`);
  if (lastHash === payloadHash) return { skipped: "same-payload-recently-sent" };

  const sendResult = await sendReply(threadId, replyBody);

  if (msgId) await mark(`msg:${msgId}`, 30 * 24 * 3600);
  await kv.set(`last:${threadId}`, payloadHash, { ex: 2 * 3600 });

HEAD
  return { ok: true, sendResult };

  return { ok: true, channelType, sendResult };

  // lib/bot.js
import { getMessageById, getThreadById, sendReply } from "./hubspot.js";
import { classifyIntent } from "./nlp.js";
import { handleQuote } from "./skills/quote.js";
import { handleMeeting } from "./skills/meeting.js";
import { handleInfo } from "./skills/info.js";
import { kvForTenant } from "./kv.js";

export async function processWebhookEvent(e, ctx) {
  const { tenantId, cfg } = ctx;
  const kv = kvForTenant(tenantId); // namespaced keys

  // ...dedupe as you already have...

  const msg = e.messageId ? await getMessageById(e.messageId, cfg.hubspot.token) : null;
  // ignore bots/agents/own-app, same as before…

  const text = msg?.text || msg?.richText || "";
  const intent = await classifyIntent(text, cfg); // lightweight model or rules

  let reply;
  if (intent === "quote" && cfg.features.quotes) {
    reply = await handleQuote({ text, cfg, tenantId });
  } else if (intent === "meeting" && cfg.features.meetings) {
    reply = await handleMeeting({ text, cfg, tenantId });
  } else if (intent === "info" && cfg.features.infoLookup) {
    reply = await handleInfo({ text, cfg, tenantId });
  } else {
    reply = `Thanks for reaching out—we’ll get back shortly.\n${cfg.brand.signature}`;
  }

  await sendReply(String(e.objectId), reply, cfg.hubspot.token); // single endpoint
  return { ok: true, tenantId, intent };
}

f6dd5e74f75b95489f0ed99361ff7fc7c6357b48
}

function hash(s) { return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0,16); }
function normalize(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function composeAutoReply(thread, msg) {
  const who = (msg && msg.sender && msg.sender.name) ? msg.sender.name : "there";
  return `Hi ${who}, thanks for reaching out! We received your message and will follow up shortly.`;
}
