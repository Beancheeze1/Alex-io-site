// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { tokenStore } from "../../../../lib/tokenStore";
import { hsFetch } from "../../../../lib/hsClient";

// Use Node runtime (Edge lacks the crypto APIs we need)
export const runtime = "nodejs";
// Never prerender this route
export const dynamic = "force-dynamic";

// Keep import from being flagged as unused until actions are wired
void tokenStore;

/** ================= Config toggles =================
 * Set VERIFY_SIGNATURE=true in prod once your app is receiving
 * real HubSpot webhooks with v3 signatures.
 */
const VERIFY_SIGNATURE = true;       // <- flip to true for production
const TOLERANCE_SECONDS = 300;        // 5 minutes freshness window
const AUTO_REPLY = true;             // <- flip to true after you confirm event types

/** ================= Helpers ================= */

function base64HmacSha256(key: string, data: string) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest("base64");
}

async function verifyV3(req: Request, rawBody: string) {
  const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
  if (!secret) return { ok: false as const, reason: "missing_client_secret" };

  const sig = req.headers.get("x-hubspot-signature-v3") || "";
  const ts = req.headers.get("x-hubspot-request-timestamp") || "";
  const ver = (req.headers.get("x-hubspot-signature-version") || "").toLowerCase();

  if (ver && ver !== "v3") return { ok: false as const, reason: `unsupported_signature_version:${ver}` };
  if (!sig || !ts) return { ok: false as const, reason: "missing_signature_headers" };

  const now = Math.floor(Date.now() / 1000);
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false as const, reason: "bad_timestamp" };
  if (Math.abs(now - tsNum) > TOLERANCE_SECONDS) return { ok: false as const, reason: "stale_request" };

  // Build signature base string: method + uri + body + timestamp
  const url = new URL(req.url);
  const method = (req.method || "POST").toUpperCase();
  const requestUri = url.pathname + (url.search || "");
  const base = method + requestUri + rawBody + ts;

  const expected = base64HmacSha256(secret, base);
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? { ok: true as const } : { ok: false as const, reason: "signature_mismatch" };
}

/** ================= Handlers ================= */

export async function GET() {
  return NextResponse.json(
    { ok: true, route: "/api/hubspot/webhook", method: "GET" },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();

    // 1) Verify signature (optional in dev)
    if (VERIFY_SIGNATURE) {
      const v = await verifyV3(req, raw);
      if (!v.ok) {
        return NextResponse.json({ ok: false, step: "verify", error: v.reason }, { status: 401 });
      }
    }

    // 2) Parse events (HubSpot sends either an array or { events: [...] })
    let events: any[] = [];
    try {
      const parsed = JSON.parse(raw);
      events = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.events) ? (parsed as any).events : [];
    } catch {
      return NextResponse.json({ ok: false, step: "parse", error: "invalid_json" }, { status: 400 });
    }

    // 3) Group by portal so we auth once per portal
    const byPortal = new Map<number, any[]>();
    for (const ev of events) {
      const portalId = Number(ev?.portalId ?? ev?.accountId);
      if (!portalId || Number.isNaN(portalId)) continue;
      if (!byPortal.has(portalId)) byPortal.set(portalId, []);
      byPortal.get(portalId)!.push(ev);
    }

    const results: any[] = [];

    for (const [portalId, evs] of byPortal.entries()) {
      // 3a) Prove auth works for this portal using tokenStore + GET inspect
try {
  const rec = await tokenStore.get(portalId);
  if (!rec) throw new Error("no token for portal");

  const inspectUrl = `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(
    rec.access_token
  )}`;

  const res = await fetch(inspectUrl, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text || res.statusText}`);
  }
  const info = await res.json().catch(() => ({}));
  results.push({ portalId, auth: "ok", tokenInfo: info });
} catch (e: any) {
  results.push({ portalId, auth: "fail", error: e?.message || String(e) });
  continue; // skip actions if auth failed
}


      // 3b) OPTIONAL: reply to new conversation messages (enable by setting AUTO_REPLY=true)
      if (AUTO_REPLY) {
        for (const ev of evs) {
          const type = ev?.subscriptionType ?? ev?.type ?? "";
          if (String(type).includes("conversations") && String(type).includes("message")) {
            const threadId =
              ev?.threadId ||
              ev?.objectId ||
              ev?.objectIdString ||
              ev?.message?.threadId;

            if (!threadId) continue;

            // Minimal text reply
            const payload = {
              type: "MESSAGE",
              text: "Thanks! We received your message and will get back to you shortly."
            };

            try {
              await hsFetch(
                portalId,
                `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(
                  threadId
                )}/messages`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload)
                }
              );
            } catch (e: any) {
              results.push({
                portalId,
                action: "reply",
                threadId,
                error: e?.message || String(e)
              });
            }
          }
        }
      }
    }

    return NextResponse.json(
      { ok: true, received: events.length, portals: results },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, step: "exception", error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
