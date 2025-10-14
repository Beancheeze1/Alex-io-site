// lib/bot.js
export const runtime = "nodejs"; // for safety if this ever gets used in a route

import crypto from "crypto";
import { getMessageById, getThreadById, sendChatReply, sendEmailReply } from "./hubspot.js";

const APP_ID = process.env.HUBSPOT_APP_ID || "0";

/* ---------- Inline KV (Redis optional, in-memory fallback) ---------- */
const hasRedis = !!process.env.REDIS_URL && !!process.env.REDIS_TOKEN;
let memory = new Map();
function now() { return Math.floor(Date.now() / 1000); }

let kv;
if (hasRedis) {
  // Lazy import to avoid bundler issues if not installed
  const { Redis } = await import("@upstash/redis").catch(() => ({ Redis: null }));
  kv = Redis
    ? new Redis({ url: process.env.REDIS_URL, token: process.env.REDIS_TOKEN })
    : {
        async get(k){ const h=memory.get(k); if(!h) return null; if(h.expiresAt<=now()){memory.delete(k); return null;} return h.value; },
        async set(k,v,o){ const ttl=(o && o.ex) ? o.ex : 3600; memory.set(k,{value:v,expiresAt:now()+ttl}); },
        async del(k){ memory.delete(k); }
      };
} else {
  kv = {
    async get(k){ const h=memory.get(k); if(!h) return null; if(h.expiresAt<=now()){memory.delete(k); return null;} return h.value; },
    async set(k,v,o){ const ttl=(o && o.ex) ? o.ex : 3600; memory.set(k,{value:v,expiresAt:now()+ttl}); },
    async del(k){ memory.delete(k); }
  };
}

async function seen(key) { return (await kv.get(key)) !== null; }
async function mark(key, ttl) { await kv.set(key, "1", { ex: ttl }); }
/* ------------------------------------------------------------------- */

function hash(s) { return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0,16); }
function normalize(s) { return String(s || "").replace(/\s+/g," ").trim(); }

export async function processWebhookEvent(e) {
  const threadId = String(e.objectId);
  const eventKey = `evt:${e.eventId}`;
  const msgId = e.messageId ? String(e.messageId) : null;

  // 1) Event-level idempotency (48h)
  if (await seen(eventKey)) return { skipped: "duplicate-event" };
  await mark(eventKey, 48*3600);

  // Only NEW_MESSAGE of type MESSAGE
  if (e.changeFlag !== "NEW_MESSAGE" || e.messageType !== "MESSAGE") {
    return { skipped: "not-a-new-message" };
  }

  // 2) Message-level idempotency (14d)
  if (msgId && await seen(`msg:${msgId}`)) return { skipped: "duplicate-message" };

  // 3) Read message to detect sender (ignore ourselves/agents/bots/system)
  const msg = msgId ? await getMessageById(msgId) : null;
  if (msg) {
    const senderAppId = String(msg?.sender?.appId ?? "");
    const senderType = String(msg?.sender?.type ?? "");
    if (senderAppId && senderAppId === String(APP_ID)) return { skipped: "from-our-app" };
    if (["BOT","AGENT","SYSTEM"].includes(senderType.toUpperCase())) return { skipped: `from-${senderType}` };
  }

  // 4) Read thread to know channel
  const thread = await getThreadById(threadId);
  const channelType = String(thread?.channelType ?? "").toUpperCase();
  if (!channelType) return { error: "no-channel", threadPreview: thread };

  // 5) Compose reply (replace with your real logic later)
  const replyBody = composeAutoReply(thread, msg);

  // 6) Per-thread payload hash guard (2h)
  const payloadHash = hash(`${threadId}:${normalize(replyBody)}`);
  const lastHash = await kv.get(`last:${threadId}`);
  if (lastHash === payloadHash) return { skipped: "same-payload-recently-sent" };

  // 7) Send exactly once based on channel
  const sendResult = channelType === "EMAIL"
    ? await sendEmailReply(threadId, replyBody)
    : await sendChatReply(threadId, replyBody);

  // 8) Mark sent for this message + remember payload
  if (msgId) await mark(`msg:${msgId}`, 30*24*3600);
  await kv.set(`last:${threadId}`, payloadHash, { ex: 2*3600 });

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

}

function composeAutoReply(thread, msg) {
  const who = (msg && msg.sender && msg.sender.name) ? msg.sender.name : "there";
  return `Hi ${who}, thanks for reaching out! We received your message and will follow up shortly.`;
}
