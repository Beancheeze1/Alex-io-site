// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";
import { remember, canPost } from "@/lib/dedupe";

// === ENV ===
const AUTO_COMMENT =
  String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";
const HUBSPOT_APP_ID = (process.env.HUBSPOT_APP_ID || "").toString();
const LOG_SELF_SKIPS =
  String(process.env.LOG_SELF_SKIPS || "false").toLowerCase() === "true";
const REPLY_COOLDOWN_SECONDS = Number(process.env.REPLY_COOLDOWN_SECONDS || 600);

// Helper to coerce values safely
const toStr = (v) => (v === undefined || v === null ? "" : String(v));

export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}

export async function POST(req) {
  try {
    const raw = await req.text();
    let events = [];
    try { events = JSON.parse(raw); } catch { /* non-JSON? ack quietly */ }
    if (!Array.isArray(events)) {
      console.log("[webhook] non-array payload; ack");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    for (const e of events) {
      // Pull fields defensively — HubSpot field names can vary
      const type       = toStr(e?.subscriptionType);
      const threadId   = toStr(e?.objectId);
      const direction  = toStr(e?.messageDirection || e?.direction).toUpperCase();
      const change     = toStr(e?.changeFlag);
      const occurredAt = Number(e?.occurredAt || e?.timestamp || 0);
      const fromAppId  = toStr(e?.appId || e?.sentByAppId);

      // 1) Basic validity
      if (type !== "conversation.newMessage" || !threadId) {
        continue; // ignore non-target events
      }

      // 2) Loop guard — only skip if this event is from *our* app AND clearly not inbound
      // (Some portals label inbound with an appId; we never skip true INBOUND.)
      if (HUBSPOT_APP_ID && fromAppId === HUBSPOT_APP_ID && direction !== "INBOUND") {
        if (LOG_SELF_SKIPS) console.log("↩︎ skip self (appId)", fromAppId, "dir:", direction);
        continue;
      }

      // 3) Inbound-only (if direction known)
      if (direction && direction !== "INBOUND") {
        // quietly ignore outbound/system messages
        continue;
      }

      // 4) Idempotency (dedupe) — MUST await since helpers are async now
      const key = `${threadId}:${occurredAt || "t"}:${change || "c"}`;
      const firstTime = await remember(key, 5 * 60 * 1000); // 5 min
      if (!firstTime) {
        // duplicate delivery or retry of same event
        continue;
      }

      // 5) Per-thread cooldown — allow 0 to mean "no cooldown"
      const cooldownMs = Math.max(0, REPLY_COOLDOWN_SECONDS * 1000);
      const allowedNow = await canPost(threadId, cooldownMs);
      if (!allowedNow) {
        console.log("↩︎ skip (cooldown)", threadId);
        continue;
      }

      // 6) Post comment
      if (!AUTO_COMMENT) {
        console.log("AUTO_COMMENT=false; would reply on", threadId);
        continue;
      }

      try {
        await postMessageToThread(
          threadId,
          process.env.REPLY_TEMPLATE ||
          "Thanks for your message — we’ll be in touch soon!",
          { type: "COMMENT" }
        );
        console.log("✅ posted COMMENT to thread", threadId);
      } catch (err) {
        console.warn("⚠️ post failed", threadId, err?.message);
      }
    }

    // Always ACK 200 so HubSpot doesn't retry storm
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] fatal:", err?.message);
    return NextResponse.json({ ok: true, note: "caught error" }, { status: 200 });
  }
}
