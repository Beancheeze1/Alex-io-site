export const runtime = "nodejs";
import { NextResponse } from "next/server";
<<<<<<< HEAD
import crypto from "crypto";
import { resolveTenantFromRequest } from "../../../../lib/tenancy.js";
import { processWebhookEvent } from "../../../../lib/bot.js";

// HubSpot V3 signature: baseString = method + path + body; HMAC SHA256 with app secret, hex
function verifySignature(req, body, secret) {
  const url = new URL(req.url);
  const method = (req.method || "POST").toUpperCase();
  const path = url.pathname + (url.search || "");
  const base = method + path + body; // per HS docs
  const expected = crypto.createHmac("sha256", String(secret)).update(base).digest("hex");
  const got = req.headers.get("x-hubspot-signature-v3") || "";
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

export async function POST(req) {
  try {
    const raw = await req.text();               // need raw for signature
    const events = JSON.parse(raw);             // HS can POST batch array
    const { tenantId, cfg } = resolveTenantFromRequest(req);

    // optional but recommended
    if (cfg.env.HUBSPOT_WEBHOOK_SECRET) {
      const ok = verifySignature(req, raw, cfg.env.HUBSPOT_WEBHOOK_SECRET);
      if (!ok) return NextResponse.json({ ok:false, error:"invalid_signature", tenantId }, { status: 401 });
    }

    const arr = Array.isArray(events) ? events : [events];
    const results = [];
    for (const e of arr) {
      try {
        results.push(await processWebhookEvent(e, { tenantId, cfg }));
      } catch (err) {
        // return 500 so HS retries transient errors
        console.error("[WEBHOOK ERR]", tenantId, e?.eventId, err);
        return NextResponse.json({ ok:false, tenantId, error:String(err?.message || err) }, { status: 500 });
      }
    }
    return NextResponse.json({ ok:true, tenantId, results });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status: 400 });
=======
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
>>>>>>> f6dd5e74f75b95489f0ed99361ff7fc7c6357b48
  }
}
