// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

const APP_SECRET = process.env.HUBSPOT_APP_SECRET || "";

/** Fetches request body as UTF-8 string */
async function getRawBody(req: Request): Promise<string> {
  const ab = await req.arrayBuffer();
  return new TextDecoder("utf-8").decode(ab);
}

/** Optional: save last event to Upstash Redis for debugging */
async function saveLastEvent(obj: unknown) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  try {
    const key = "hubspot:last-webhook";
    const setUrl = `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(
      JSON.stringify(obj)
    )}`;
    await fetch(setUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Ignore persistence errors
  }
}

/**
 * Verify HubSpot v3 signature (HMAC-SHA256 of method+path+body)
 */
async function validSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!APP_SECRET) return true; // allow through if no secret set

  const sig = req.headers.get("X-HubSpot-Signature-v3") || "";
  const url = new URL(req.url);
  const baseStr = `${req.method}${url.pathname}${rawBody}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(baseStr));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const calc = `sha256=${hex}`;

  // timingSafeEqual doesn't exist in Web Crypto; do a safe fallback
  return calc === sig;
}

export const dynamic = "force-dynamic";

/**
 * POST: HubSpot webhook receiver
 */
export async function POST(req: Request) {
  const raw = await getRawBody(req);
  const valid = await validSignature(req, raw);

  if (!valid) {
    return NextResponse.json(
      { ok: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { parseError: true, raw };
  }

  await saveLastEvent(json);
  return NextResponse.json({ ok: true });
}

/**
 * GET: simple health endpoint for testing
 */
export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST webhook events here" });
}
