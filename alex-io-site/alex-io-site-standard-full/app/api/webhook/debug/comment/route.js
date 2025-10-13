// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";

const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";

/** GET: lets you confirm the path from a browser */
export async function GET() {
  console.log("[webhook][GET] /api/hubspot/webhook");
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}

/** POST: HubSpot webhook */
export async function POST(req) {
  try {
    const raw = await req.text();
    console.log("[webhook][POST] raw preview:", (raw || "").slice(0, 500));

    let events = [];
    try { events = JSON.parse(raw); } catch { events = []; }

    if (!Array.isArray(events)) {
      console.warn("[webhook] non-array body");
      return NextResponse.json({ ok: true, note: "non-array body" }, { status: 200 });
    }

    for (const e of events) {
      const type = e?.subscriptionType;
      const threadId = e?.objectId;
      const msgType = e?.messageType;
      const change  = e?.changeFlag;

      console.log("[webhook] event:", { type, threadId, msgType, change });

      const isNewInbound =
        type === "conversation.newMessage" &&
        (msgType === "MESSAGE" || !msgType) &&
        (change === "NEW_MESSAGE" || !change);

      if (!isNewInbound || !threadId) continue;

      if (AUTO_COMMENT) {
        try {
          await postMessageToThread(threadId, "Thanks for your message — we’ll be in touch soon!");
          console.log("✅ posted auto-comment (thread):", threadId);
        } catch (err) {
          console.error("❌ HubSpot post failed:", err?.message);
        }
      } else {
        console.log("[webhook] AUTO_COMMENT=false; not posting");
      }
    }

    // Always 200 to avoid retry storms
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] fatal:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 200 });
  }
}

