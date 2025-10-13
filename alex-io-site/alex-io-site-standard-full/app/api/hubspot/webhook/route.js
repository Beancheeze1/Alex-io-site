// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import {
  getConversationIdFromThread,
  postHubSpotMessage,
  isFromOurApp,
} from "@/lib/hubspot";

// Toggle behavior via env (strings)
const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";
const AUTO_REPLY   = String(process.env.AUTO_REPLY   || "false").toLowerCase() === "true";

// Simple content builder for your auto-comment
function buildAutoCommentText(event) {
  // You can customize with channel/message details if needed
  return "Thanks for your message — we’ll be in touch soon!";
}

// Next.js App Router webhook endpoint
export async function POST(req) {
  try {
    const bodyText = await req.text(); // HubSpot sends an array of events
    let events;
    try {
      events = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, note: "No events" }, { status: 200 });
    }

    for (const event of events) {
      // Example event fields we rely on:
      // subscriptionType, objectId (threadId), messageId, messageType, appId, occurredAt
      const {
        subscriptionType,
        objectId: threadId,
        appId: eventAppId,
        messageType,
        changeFlag,
      } = event || {};

      console.log("🔔 Webhook event:", {
        subscriptionType,
        threadId,
        messageType,
        changeFlag,
        eventAppId,
      });

      // Loop guard: skip if webhook is fired on our own app messages (if provided)
      if (isFromOurApp(eventAppId)) {
        console.log("Skipping (own app message)");
        continue;
      }

      // We only auto-act on new inbound messages
      const isNewInboundMessage =
        subscriptionType === "conversation.newMessage" &&
        (messageType === "MESSAGE" || !messageType) &&
        (changeFlag === "NEW_MESSAGE" || !changeFlag);

      if (!isNewInboundMessage) continue;

      // Resolve conversationId from threadId
      let conversationId = null;
      try {
        conversationId = await getConversationIdFromThread(threadId);
      } catch (e) {
        console.error("Failed to resolve conversationId:", e?.message);
        continue; // proceed to next event
      }

      // AUTO_COMMENT: post a lightweight internal-looking message in the thread
      if (AUTO_COMMENT) {
        try {
          const text = buildAutoCommentText(event);
          await postHubSpotMessage(conversationId, text);
          console.log("✅ Auto-comment posted");
        } catch (e) {
          console.error("❌ Auto-comment failed:", e?.message);
        }
      }

      // AUTO_REPLY: (email-like) — if you later add a separate email reply flow,
      // guard it here so you don’t double post. For now, keep disabled by default.
      if (AUTO_REPLY) {
        console.log("AUTO_REPLY is enabled but not implemented in this route.");
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] error", err?.message);
    return NextResponse.json({ error: err?.message ?? "unknown" }, { status: 500 });
  }
}

