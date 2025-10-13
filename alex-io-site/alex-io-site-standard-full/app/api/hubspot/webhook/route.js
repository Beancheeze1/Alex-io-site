// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import { getConversationIdFromThread, postHubSpotMessage } from "../../../../lib/hubspot";

const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";

export async function POST(req) {
  const raw = await req.text();
  let events = [];
  try { events = JSON.parse(raw); } catch {}
  for (const e of (Array.isArray(events) ? events : [])) {
    if (e.subscriptionType !== "conversation.newMessage") continue;
    const threadId = e.objectId;
    if (!threadId) continue;

    // EITHER: resolve conversationId then post…
    const conversationId = await getConversationIdFromThread(threadId).catch(() => null);

    if (AUTO_COMMENT && conversationId) {
      await postHubSpotMessage(conversationId, "Thanks for your message — we’ll be in touch soon!");
      console.log("✅ Auto-comment posted");
    }
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
