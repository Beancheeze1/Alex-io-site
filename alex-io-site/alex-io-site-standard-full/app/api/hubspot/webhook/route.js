// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";
import { remember, canPost } from "@/lib/dedupe";

// === ENV toggles ===
const AUTO_COMMENT =
  String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";

// Force reply: if true, reply to EVERY conversation.newMessage event
// (except our own appId), ignoring cooldown/direction/dedupe.
const FORCE_REPLY =
  String(process.env.FORCE_REPLY || "false").toLowerCase() === "true";

const HUBSPOT_APP_ID = (process.env.HUBSPOT_APP_ID || "").toString();
const LOG_EVENTS =
  String(process.env.LOG_EVENT_SUMMARY || "true").toLowerCase() === "true";

const REPLY_COOLDOWN_SECONDS = Number(process.env.REPLY_COOLDOWN_SECONDS || 0); // default 0 for now
const REPLY_TEXT =
  process.env.REPLY_TEMPLATE ||
  "Thanks for your message — we’ll be in touch soon!";

// helpers
const S = v => (v === undefined || v === null ? "" : String(v));

export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}

export async function POST(req) {
  try {
    const raw = await req.text();
    let events = [];
    try { events = JSON.parse(raw); } catch { /* non-json */ }

    if (!Array.isArray(events)) {
      console.log("[webhook] non-array payload; ack");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    for (const e of events) {
      const type       = S(e?.subscriptionType);
      const threadId   = S(e?.objectId);
      const direction  = S(e?.messageDirection || e?.direction).toUpperCase(); // may be ""
      const change     = S(e?.changeFlag);
      const fromAppId  = S(e?.appId || e?.sentByAppId);
      const occurredAt = Number(e?.occurredAt || e?.timestamp || 0);

      if (LOG_EVENTS) {
        console.log("[evt]", {
          type, threadId, direction, change, fromAppId, occurredAt
        });
      }

      // only target new message events with a thread id
      if (type !== "conversation.newMessage" || !threadId) continue;

      // never loop on our own posts
      if (HUBSPOT_APP_ID && fromAppId === HUBSPOT_APP_ID) {
        // quiet skip
        continue;
      }

      // FORCE mode: post and skip all other guards (best for bringing it back)
      if (AUTO_COMMENT && FORCE_REPLY) {
        try {
          await postMessageToThread(threadId, REPLY_TEXT, { type: "COMMENT" });
          console.log("✅ FORCE posted to thread", threadId);
        } catch (err) {
          console.warn("⚠️ FORCE post failed", threadId, err?.message);
        }
        continue;
      }

      // Normal mode below — minimal safe guards

      // Treat unknown direction as inbound (some portals omit it)
      if (direction && direction !== "INBOUND") {
        continue;
      }

      // Idempotency: dedupe per (threadId, occurredAt, change) for 3 min
      const key = `${threadId}:${occurredAt || "t"}:${change || "c"}`;
      const first = await remember(key, 3 * 60 * 1000);
      if (!first) continue;

      // Cooldown (allow 0 = disabled)
      const ms = Math.max(0, REPLY_COOLDOWN_SECONDS * 1000);
      const okNow = await canPost(threadId, ms);
      if (!okNow) {
        console.log("↩︎ skip cooldown", threadId);
        continue;
      }

      if (!AUTO_COMMENT) continue;

      try {
        await postMessageToThread(threadId, REPLY_TEXT, { type: "COMMENT" });
        console.log("✅ posted to thread", threadId);
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
