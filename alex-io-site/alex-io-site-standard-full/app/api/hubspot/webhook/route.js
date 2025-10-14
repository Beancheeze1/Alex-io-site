import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";

const AUTO_COMMENT =
  String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";

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
      const type = e?.subscriptionType;
      const threadId = e?.objectId;
      if (type !== "conversation.newMessage" || !threadId) continue;

      if (AUTO_COMMENT) {
        try {
          // default in your helper is COMMENT; pass explicitly for clarity
          await postMessageToThread(threadId, "Thanks for your message — we’ll be in touch soon!", { type: "COMMENT" });
          console.log("✅ auto-comment posted to thread", threadId);
        } catch (err) {
          console.error("❌ auto-comment failed:", err?.message);
        }
      }
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("webhook error:", err?.message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

