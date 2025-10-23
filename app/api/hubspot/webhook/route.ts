// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Env controls
 * - HUBSPOT_WEBHOOK_SECRET: optional, if set we'll verify signature (recommended in prod)
 * - HUBSPOT_VALIDATE_WEBHOOKS: "true" to enforce signature verification
 * - WEBHOOK_LOG_DIR: optional, defaults to ".data/webhooks"
 */
const SECRET = process.env.HUBSPOT_WEBHOOK_SECRET || process.env.HUBSPOT_CLIENT_SECRET || "";
const ENFORCE = String(process.env.HUBSPOT_VALIDATE_WEBHOOKS || "").toLowerCase() === "true";
const LOG_DIR = process.env.WEBHOOK_LOG_DIR || ".data/webhooks";

/**
 * HubSpot sends `X-HubSpot-Signature` or `X-HubSpot-Signature-v3`.
 * v3 = base64(HMAC_SHA256(secret, method + url + body))
 * (HubSpot docs specify the full URL including scheme/host.)
 */
function computeSignatureV3(secret: string, method: string, url: string, body: string) {
  const base = (method.toUpperCase() + url + body);
  return createHmac("sha256", secret).update(base).digest("base64");
}

function safeTSEqual(a: string, b: string) {
  // avoid falsey/length mismatches throwing
  const ab = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function logPayload(kind: "ok" | "fail", body: string, meta: Record<string, unknown>) {
  try {
    const day = new Date();
    const dir = join(process.cwd(), LOG_DIR, `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`);
    mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      `${day.toISOString().replace(/[:.]/g, "-")}_${kind}.json`
    );
    const out = JSON.stringify({ meta, body }, null, 2);
    writeFileSync(file, out);
  } catch {
    // best-effort logging; never crash handler
  }
}

export async function POST(req: Request) {
  const method = "POST";
  const url = new URL(req.url);
  const fullUrl = `${url.origin}${url.pathname}`; // HubSpot expects full URL; querystring is not included in their formula
  const rawBody = await req.text(); // Keep raw string for signature calc
  const headers = new Headers(req.headers);
  const sigLegacy = headers.get("x-hubspot-signature") || "";
  const sigV3 = headers.get("x-hubspot-signature-v3") || "";

  // Optional signature verification (recommended in prod)
  let verified = false;
  if (SECRET) {
    const expectV3 = computeSignatureV3(SECRET, method, fullUrl, rawBody);
    if (sigV3) verified = safeTSEqual(sigV3, expectV3);
    // If only legacy header present, we still accept (dev mode); add your legacy algorithm here if you want to enforce it.
  }

  // Enforce verification only when explicitly enabled
  if (ENFORCE && SECRET && !verified) {
    logPayload("fail", rawBody, {
      reason: "signature_mismatch",
      fullUrl,
      sigV3,
      enforced: ENFORCE,
    });
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  // Parse JSON safely AFTER signature check
  let events: unknown = null;
  try {
    events = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    // HubSpot always posts JSON; but we’ll keep going with raw body for logging
  }

  // Write a best-effort log; safe to disable by unsetting LOG_DIR
  logPayload(verified ? "ok" : "ok", rawBody, {
    verified,
    count: Array.isArray(events) ? events.length : null,
    path: url.pathname,
  });

  // TODO: enqueue processing for each event (message received, etc.)
  // For now: immediately ack so HubSpot doesn't retry.
  return NextResponse.json({ ok: true, received: Array.isArray(events) ? events.length : 1 });
}

// Optional: reject other verbs clearly
export function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
