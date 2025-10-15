// app/api/hubspot/webhook/route.js
import { NextResponse } from "next/server";
import crypto from "crypto";
import { kvGet, kvSet } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ----- utils -----
function safeEq(a, b) {
  try {
    const A = Buffer.from(a || "");
    const B = Buffer.from(b || "");
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

// HubSpot v3 signature: sha256 HMAC of METHOD + PATH + RAW_BODY
function verifySignature(req, rawBody, secret) {
  if (!secret) return { ok: true, reason: "no-secret-configured" };
  const path = new URL(req.url).pathname;
  const base = req.method.toUpperCase() + path + rawBody;
  const expected = crypto.createHmac("sha256", secret).update(base).digest("hex");
  const got =
    req.headers.get("x-hubspot-signature-v3") ||
    req.headers.get("x-hubspot-signature"); // older header
  if (!got) return { ok: false, reason: "missing-signature-header" };
  if (!safeEq(expected, got)) return { ok: false, reason: "bad-signature" };
  return { ok: true };
}

function cooldownSec() {
  const n = Number(process.env.BOT_REPLY_COOLDOWN_SECONDS);
  return Number.isFinite(n) && n >= 0 ? n : 120;
}

function idsFrom(events) {
  const e = Array.isArray(events) ? events[0] : null;
  return {
    threadId: e?.objectId?.toString?.() || e?.threadId?.toString?.() || null,
    conversationId: e?.conversationId?.toString?.() || null,
    messageId: e?.messageId || null,
  };
}

// ----- handlers -----
export async function POST(req) {
  try {
    const raw = await req.text();
    let events;
    try {
      events = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid-json" }, { status: 400 });
    }

    const sig = verifySignature(req, raw, process.env.HUBSPOT_WEBHOOK_SECRET || "");
    if (!sig.ok) {
      return NextResponse.json({ ok: false, error: "signature-failed", reason: sig.reason }, { status: 401 });
    }

    const { threadId, conversationId, messageId } = idsFrom(events);
    if (!threadId) return NextResponse.json({ ok: true, skipped: "no-thread-id" });

    // cooldown/dedup
    const cd = cooldownSec();
    const key = `hubspot:reply-lock:${threadId}:${messageId || "no-msg"}`;
    if (await kvGet(key)) return NextResponse.json({ ok: true, skipped: "cooldown" });
    await kvSet(key, "1", cd);

    // filter message events only
    const relevant = events.filter((e) =>
      (e.subscriptionType || "").toLowerCase().includes("newmessage") ||
      (e.messageType || "").toLowerCase() === "message"
    );
    if (relevant.length === 0) return NextResponse.json({ ok: true, skipped: "no-message-event" });

    // TODO: fetch latest thread → generate reply → post reply
    console.log("🔔 Webhook", { count: events.length, threadId, conversationId, messageId });

    return NextResponse.json({ ok: true, handled: true, threadId, conversationId, cooldownSeconds: cd });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false, error: "server-error", detail: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/hubspot/webhook" });
}
