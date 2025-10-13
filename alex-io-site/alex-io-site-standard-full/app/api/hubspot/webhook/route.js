// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import { postMessageToThread } from "../../../../../lib/hubspot"; // adjust if file depth differs

const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";

/** ✅ GET route to verify your endpoint from browser or curl */
export async function GET() {
  console.log("[webhook][GET] /api/hubspot/webhook route hit");
  return NextResponse.json(
    { ok: true, path: "/api/hubspot/webhook", note: "GET works ✅" },
    { status: 200 }
  );
}

/** ✅ POST route HubSpot actually calls */
export async function POST(req) {
  try {
    const raw = await req.text();
    console.log("[webhook][POST] raw body preview:", (raw || "").slice(0, 500));

    let events = [];
    try {
      events = JSON.parse(raw);
    } catch {
      console.warn("[webhook] body is not valid JSON");
      return NextResponse.json({ ok: true, note: "invalid JSON" }, { status: 200 });
    }

    if (!Array.isArray(events)) {
      console.warn("[webhook] expected array, got", typeof events);
      return NextResponse.json({ ok: true, note: "non-array body" }, { status: 200 });
    }

    for (const e of events) {
      const type = e?.subscriptionType;
      const threadId = e?.objectId;
      const msgType = e?.messageType;
      const change = e?.changeFlag;

      console.log("[webhook] event:", { type, threadId, msgType, change });

      // only handle new inbound messages
      const isNewMessage =
        type === "conversation.newMessage" &&
        (msgType === "MESSAGE" || !msgType) &&
        (change === "NEW_MESSAGE" || !change);

      if (!isNewMessage || !threadId) continue;

      if (AUTO_COMMENT) {
        try {
          await postMessageToThread(
            threadId,
            "Thanks for your message — we’ll be in touch soon!"
          );
          console.log("✅ posted auto-comment to thread:", threadId);
        } catch (err) {
          console.error("❌ HubSpot POST failed:", err?.message);
        }
      } else {
        console.log("[webhook] AUTO_COMMENT=false; no reply");
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] fatal error:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 200 });
  }
}
