// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";
import { remember, canPost } from "@/lib/dedupe";

// ====== toggles ======
const AUTO_COMMENT =
  String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";
const HUBSPOT_APP_ID = (process.env.HUBSPOT_APP_ID || "").toString();

// Set LOG_SELF_SKIPS=true in env if you want to see "skip (our own appId)" lines.
// Otherwise, self-generated events are silently ignored.
const LOG_SELF_SKIPS =
  String(process.env.LOG_SELF_SKIPS || "false").toLowerCase() === "true";

// how long to wait before we post again on the same thread (in seconds)
const REPLY_COOLDOWN_SECONDS = Number(
  process.env.REPLY_COOLDOWN_SECONDS || 600 // 10 minutes
);

export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}

export async function POST(req) {
  try {
    const raw = await req.text();
    let events = [];
    try { events = JSON.parse(raw); } catch {}

    if (!Array.isArray(events)) {
      return NextResponse.json({ ok: true, note: "non-array" }, { status: 200 });
    }

    for (const e of events) {
      const type = e?.subscriptionType;
      const threadId = e?.objectId?.toString();
      const direction = (e?.messageDirection || e?.direction || "").toUpperCase();
      const change = e?.changeFlag || "";
      const occurredAt = e?.occurredAt || e?.timestamp || 0;
      const fromAppId = (e?.appId || e?.sentByAppId || "").toString();

      // Only handle new messages
      if (type !== "conversation.newMessage" || !threadId) continue;

      // Loop guard — ignore our own bot posts (quiet unless LOG_SELF_SKIPS=true)
      if (HUBSPOT_APP_ID && fromAppId && fromAppId === HUBSPOT_APP_ID) {
        if (LOG_SELF_SKIPS) console.log("↩︎ skip (our own appId)", fromAppId);
        continue;
      }

      // Only respond to inbound/human messages (quiet skip)
      if (direction && direction !== "INBOUND") continue;

      // Idempotency — dedupe same event for 5 minutes
      const key = `${threadId}:${occurredAt}:${change}`;
      if (!remember(key, 5 * 60 * 1000)) continue;

      // Per-thread cooldown
      if (!canPost(threadId, REPLY_COOLDOWN_SECONDS * 1000)) continue;

      if (!AUTO_COMMENT) continue;

      try {
        // Internal comment (safe minimal payload)
        await postMessageToThread(
          threadId,
          "Thanks for your message — we’ll be in touch soon!",
          { type: "COMMENT" }
        );
        console.log("✅ auto-comment posted", threadId);
      } catch (err) {
        console.warn("⚠️ post failed", threadId, err?.message);
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("webhook fatal:", err?.message);
    return NextResponse.json({ ok: true, note: "caught error" }, { status: 200 });
  }
}
