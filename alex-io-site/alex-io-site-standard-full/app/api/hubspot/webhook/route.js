import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";
import { remember, canPost } from "@/lib/dedupe";

const ENV = (k, d="") => (process.env[k] ?? d);
const BOOL = (k, d="false") => String(ENV(k, d)).toLowerCase() === "true";
const NUM  = (k, d=0) => Number(ENV(k, String(d)));

const AUTO_COMMENT   = BOOL("AUTO_COMMENT", "true");
const FORCE_REPLY    = BOOL("FORCE_REPLY", "false");         // for emergencies
const LOG_EVENTS     = BOOL("LOG_EVENT_SUMMARY", "true");
const HUBSPOT_APP_ID = ENV("HUBSPOT_APP_ID", "");
const REPLY_TEXT     = ENV("REPLY_TEMPLATE", "Thanks for your message — we’ll be in touch soon!");
const REPLY_COOLDOWN_SECONDS = NUM("REPLY_COOLDOWN_SECONDS", 120); // 0 = disabled

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
      const direction  = S(e?.messageDirection || e?.direction).toUpperCase(); // can be ""
      const change     = S(e?.changeFlag);
      const fromAppId  = S(e?.appId || e?.sentByAppId);
      const occurredAt = Number(e?.occurredAt || e?.timestamp || 0);

      // Try to capture any message id HubSpot might include
      const msgId = S(e?.id || e?.messageId || e?.hsMessageId || e?.eventId);

      // Build a *stable* fallback key when message id is missing:
      // use 10-second bucket for occurredAt to absorb minor jitter
      const bucket10s = occurredAt ? Math.floor(occurredAt / 10000) : 0;
      const fallbackKey = `t:${threadId}|b10:${bucket10s}|chg:${change || "-"}`;

      // Strong dedupe key preference: message id > fallback bucket
      const dedupeKey = msgId ? `msg:${msgId}` : fallbackKey;

      if (LOG_EVENTS) {
        console.log("[evt]", { type, threadId, direction, change, fromAppId, occurredAt, msgId, dedupeKey });
      }

      // Only handle new-message events with a thread id
      if (type !== "conversation.newMessage" || !threadId) continue;

      // Loop guard: skip *obvious* self outbound events.
      // If direction is missing, treat as inbound to avoid skipping real contacts.
      const isSelf   = HUBSPOT_APP_ID && fromAppId === HUBSPOT_APP_ID;
      const inbound  = !direction || direction === "INBOUND";
      if (isSelf && !inbound) continue;

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

      // === LAYER 1: strong idempotency (3 min window) ===
      const first = await remember(dedupeKey, 3 * 60 * 1000);
      if (!first) {
        if (LOG_EVENTS) console.log("↩︎ skip (dedupe)", dedupeKey);
        continue;
      }

      // === LAYER 2: per-thread cooldown (0 disables) ===
      const okNow = await canPost(threadId, Math.max(0, REPLY_COOLDOWN_SECONDS * 1000));
      if (!okNow) {
        if (LOG_EVENTS) console.log("↩︎ skip (cooldown)", threadId);
        continue;
      }

      if (!AUTO_COMMENT) continue;

      // === LAYER 3: post comment ===
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
