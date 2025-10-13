
import { NextResponse } from "next/server";
import { postHubSpotMessage } from "../../../../../lib/hubspot";

const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";
console.log("threadId:", e?.objectId);

export async function POST(req) {
  try {
    const raw = await req.text();
    let events = [];
    try { events = JSON.parse(raw); } catch {}
    for (const e of (Array.isArray(events) ? events : [])) {
      if (e?.subscriptionType !== "conversation.newMessage") continue;
      const threadId = e?.objectId;
      if (!threadId) continue;

      if (AUTO_COMMENT) {
        try {
          await postHubSpotMessage(threadId, "Thanks for your message — we’ll be in touch soon!", { kind: "thread" });
          console.log("✅ Auto-comment posted (thread)", threadId);
        } catch (err) {
          console.error("❌ HubSpot post failed:", err.message);
        }
      }
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("webhook error:", err?.message);
    return NextResponse.json({ error: err?.message ?? "unknown" }, { status: 500 });
  }
}

// Keep a quick GET to verify path in browser if needed
export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}
