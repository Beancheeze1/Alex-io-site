// app/api/hubspot/webhook/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { processWebhookEvent } from "../../../../lib/bot.js";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const events = Array.isArray(body) ? body : [body];

  const results = [];
  for (const e of events) {
    try {
      if (e.subscriptionType !== "conversation.newMessage") {
        results.push({ skipped: "wrong-subscriptionType" });
        continue;
      }
      const r = await processWebhookEvent(e);
      results.push(r);
    } catch (err) {
      results.push({ error: String(err && err.message || err) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
