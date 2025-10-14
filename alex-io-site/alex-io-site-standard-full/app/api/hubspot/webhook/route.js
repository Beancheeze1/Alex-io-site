import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";
import { remember, canPost } from "@/lib/dedupe";

const AUTO_COMMENT   = (process.env.AUTO_COMMENT || "false").toLowerCase() === "true";
const HUBSPOT_APP_ID = (process.env.HUBSPOT_APP_ID || "").toString();
const FORCE_REPLY    = (process.env.FORCE_REPLY || "false").toLowerCase() === "true";
const LOG_EVENTS     = (process.env.LOG_EVENT_SUMMARY || "true").toLowerCase() === "true";
const REPLY_TEXT     = process.env.REPLY_TEMPLATE || "Thanks for your message — we’ll be in touch soon!";
const REPLY_COOLDOWN_SECONDS = Number(process.env.REPLY_COOLDOWN_SECONDS || 0); // allow 0

const S = v => (v == null ? "" : String(v));

export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}

export async function POST(req) {
  try {
    const raw = await req.text();
    let events = [];
    try { events = JSON.parse(raw); } catch {}

    if (!Array.isArray(events)) return NextResponse.json({ ok: true }, { status: 200 });

    for (const e of events) {
      const type       = S(e?.subscriptionType);
      const threadId   = S(e?.objectId);
      const direction  = S(e?.messageDirection || e?.direction).toUpperCase(); // may be ""
      const change     = S(e?.changeFlag);
      const fromAppId  = S(e?.appId || e?.sentByAppId);
      const occurredAt = Number(e?.occurredAt || e?.timestamp || 0);

      // best-effort message id for strong dedupe
      const msgId = S(e?.id || e?.messageId || e?.hsMessageId || e?.eventId);
      const dedupeKey = msgId
        ? `msg:${msgId}`
        : `t:${threadId}|ts:${occurredAt}|c:${change}`;

      if (LOG_EVENTS) {
        console.log("[evt]", { type, threadId, direction, change, fromAppId, occurredAt, msgId });
      }

      // must be the right event
      if (type !== "conversation.newMessage" || !threadId) continue;

      // loop guard: if it’s clearly our own outbound, skip
      const isSelf = HUBSPOT_APP_ID && fromAppId === HUBSPOT_APP_ID;
      const isInbound = !direction || direction === "INBOUND";
      if (isSelf && !isInbound) continue;

      // FORCE mode: reply unconditionally (except loop guard)
      if (AUTO_COMMENT && FORCE_REPLY) {
        try {
          await postMessageToThread(threadId, REPLY_TEXT, { type: "COMMENT" });
          console.log("✅ FORCE posted", threadId);
        } catch (err) {
          console.warn("⚠️ FORCE post failed", threadId, err?.message);
        }
        continue;
      }

      // strong idempotency (3 min)
      const first = await remember(dedupeKey, 3 * 60 * 1000);
      if (!first) continue;

      // cooldown (0 disables)
      const okNow = await canPost(threadId, Math.max(0, REPLY_COOLDOWN_SECONDS * 1000));
      if (!okNow) continue;

      if (!AUTO_COMMENT) continue;

      try {
        await postMessageToThread(threadId, REPLY_TEXT, { type: "COMMENT" });
        console.log("✅ posted", threadId);
      } catch (err) {
        console.warn("⚠️ post failed", threadId, err?.message);
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] fatal:", err?.message);
    return NextResponse.json({ ok: true, note: "caught error" }, { status: 200 });
  }
}
