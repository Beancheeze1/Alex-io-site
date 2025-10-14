// app/api/hubspot/webhook/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { resolveTenant } from "../../../../lib/tenancy.js";
import { processWebhookEvent } from "../../../../lib/bot.js";

export async function POST(req) {
  try {
    const { tenantId, cfg } = resolveTenant(req);
    const events = [].concat(await req.json());
    const results = [];
    for (const e of events) {
      results.push(await processWebhookEvent(e, { tenantId, cfg }));
    }
    return NextResponse.json({ ok: true, tenantId, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
}
