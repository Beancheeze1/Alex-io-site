import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";
import { remember, canPost } from "@/lib/dedupe";

const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";
const HUBSPOT_APP_ID = process.env.HUBSPOT_APP_ID || "";       // optional but nice
const REPLY_COOLDOWN_SECONDS = Number(process.env.REPLY_COOLDOWN_SECONDS || 600); // 10m default

export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}

export async function POST(req) {
  try {
    const raw = await req.text();
    let events = [];
    try { events = JSON.parse(raw); } catch {}
    if (!Array.isArray(events)) return NextResponse.json({ ok: true, note: "non-array" }, { status: 200 });

    for (const e of events) {
      const type = e?.subscriptionType;
      const threadId = e?.objectId?.toString();
      const direction = e?.messageDirection || e?.direction;   // HubSpot sometimes uses messageDirection
      const change = e?.changeFlag || "";
      const occurredAt = e?.occurredAt || e?.timestamp || 0;
      const fromAppId = (e?.appId || e?.sentByAppId || "").toString();

      // Only handle "new message" events on threads
      if (type !== "conversation.newMessage" || !threadId) continue;

      // Loop guard: ignore our own posts
      if (HUBSPOT_APP_ID && fromAppId && fromAppId === String(HUBSPOT_APP_ID)) {
        console.log("↩︎ skip (our own appId)", fromAppId);
        continue;
      }

      // Direction guard: only reply to inbound (human) messages
      if (direction && direction.toUpperCase() !== "INBOUND") {
        console.log("↩︎ skip (direction)", direction);
        continue;
      }

      // Idempotency guard: HubSpot may retry or send multiple events
      const key = `${threadId}:${occurredAt}:${change}`;
      if (!remember(key, 5 * 60 * 1000)) {        // 5 min dedupe
        console.log("↩︎ skip (duplicate event)", key);
        continue;
      }

      // Per-thread cooldown to avoid multiple posts in fast successions
      if (!canPost(threadId, REPLY_COOLDOWN_SECONDS * 1000)) {
        console.log("↩︎ skip (cooldown)", threadId);
        continue;
      }

      if (!AUTO_COMMENT) {
        console.log("AUTO_COMMENT=false; would have posted on", threadId);
        continue;
      }

      try {
        // Post a COMMENT (internal note); change to MESSAGE only if you supply full message fields
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

    // Always ACK 200 to avoid retry storms
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("webhook fatal:", err?.message);
    return NextResponse.json({ ok: true, note: "caught error" }, { status: 200 });
  }
}
