// app/api/hubspot/webhook/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { processWebhookEvent } from "../../../../lib/bot.js";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    console.warn("[WEBHOOK] invalid-json");
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const events = Array.isArray(body) ? body : [body];
  console.log("[WEBHOOK] batch size =", events.length);

  const results = [];
  for (const e of events) {
    try {
      if (e.subscriptionType !== "conversation.newMessage") {
        console.log("[WEBHOOK] skipped wrong type", e.subscriptionType);
        results.push({ skipped: "wrong-subscriptionType" });
        continue;
      }
      const r = await processWebhookEvent(e);
      console.log("[WEBHOOK] processed", r);
      results.push(r);
    } catch (err) {
      console.error("[WEBHOOK] error", String(err?.message || err));
      results.push({ error: String(err?.message || err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
