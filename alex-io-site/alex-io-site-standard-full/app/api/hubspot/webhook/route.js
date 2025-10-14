import { NextResponse } from "next/server";
import { postMessageToThread } from "@/lib/hubspot";

const AUTO_COMMENT = String(process.env.AUTO_COMMENT || "false").toLowerCase() === "true";

// helper: run a promise with a timeout
async function withTimeout(promise, ms = 3000) {
  let t; const timeout = new Promise((_, rej) => t = setTimeout(() => rej(new Error("timeout")), ms));
  try { const res = await Promise.race([promise, timeout]); clearTimeout(t); return res; }
  catch (e) { clearTimeout(t); throw e; }
}

export async function GET() {
  return NextResponse.json({ ok: true, path: "/api/hubspot/webhook" }, { status: 200 });
}

export async function POST(req) {
  try {
    const raw = await req.text();
    let events = [];
    try { events = JSON.parse(raw); } catch {}
    if (!Array.isArray(events)) return NextResponse.json({ ok: true, note: "non-array body" }, { status: 200 });

    for (const e of events) {
      const type = e?.subscriptionType;
      const threadId = e?.objectId;
      if (type !== "conversation.newMessage" || !threadId) continue;

      if (AUTO_COMMENT) {
        // try to post a COMMENT quickly; if it times out or fails, log and move on
        try {
          await withTimeout(postMessageToThread(threadId, "Thanks for your message — we’ll be in touch soon!", { type: "COMMENT" }), 3000);
          console.log("✅ auto-comment posted to thread", threadId);
        } catch (err) {
          console.warn("⚠️ auto-comment defer/fail:", err?.message);
        }
      }
    }

    // Always 200 so HubSpot doesn't see 5xx/timeouts
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] fatal:", err?.message);
    return NextResponse.json({ ok: true, note: "caught error" }, { status: 200 });
  }
}
