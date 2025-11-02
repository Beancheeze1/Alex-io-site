// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { pickTemplate } from "@/app/lib/templates";
export const dynamic = "force-dynamic";

/**
 * Webhook with:
 *  - lookup fallback
 *  - idempotency + cooldown
 *  - per-inbox/pipeline template selection
 */

function asBool(v: unknown) { return String(v ?? "").toLowerCase() === "true"; }
function get(o: any, path: string[]) { return path.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o); }
function isEmail(s: unknown): s is string { return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function extractMessageId(evt: any): string | null {
  const headers = get(evt, ["message", "headers"]) || get(evt, ["object", "message", "headers"]) || {};
  const mid = headers["Message-Id"] || headers["message-id"] || headers["MESSAGE-ID"] || evt?.messageId || evt?.object?.messageId || null;
  return typeof mid === "string" && mid.length > 6 ? String(mid) : null;
}
function hasLoopHeader(evt: any): boolean {
  const headers = get(evt, ["message", "headers"]) || get(evt, ["object", "message", "headers"]) || {};
  const v = headers["X-AlexIO-Responder"] || headers["x-alexio-responder"] || headers["X-ALEXIO-RESPONDER"] || "";
  return String(v).trim() === "1";
}
function isNewInbound(evt: any): boolean {
  const subscriptionType = String(evt?.subscriptionType ?? "");
  const eventType = String(evt?.eventType ?? "");
  const changeFlag = String(evt?.changeFlag ?? "");
  const messageType = String(evt?.messageType ?? "");
  return (
    subscriptionType.includes("conversation.newMessage") ||
    eventType.includes("newMessage") ||
    changeFlag === "NEW_MESSAGE" ||
    messageType === "MESSAGE"
  );
}

async function postJson(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function POST(req: NextRequest) {
  try {
    const startedAt = Date.now();
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const replyEnabled = asBool(process.env.REPLY_ENABLED);
    const SELF = process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;
    const SEND = process.env.INTERNAL_SEND_URL || new URL("/api/msgraph/send", url).toString();

    const kv = makeKv();
    const cooldownMin = Number(process.env.REPLY_COOLDOWN_MIN ?? 120);
    const idemTtlMin = Number(process.env.IDEMP_TTL_MIN ?? 1440);

    const events = (await req.json()) as any[];
    if (!Array.isArray(events) || events.length === 0) {
      console.log("[webhook] IGNORE no_events");
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });
    }

    const evt = events[0];
    const subtype = {
      subscriptionType: evt?.subscriptionType ?? null,
      eventType: evt?.eventType ?? null,
      changeFlag: evt?.changeFlag ?? null,
      messageType: evt?.messageType ?? null,
    };
    const objectId = evt?.objectId ?? evt?.threadId ?? null;
    const rawMessageId = extractMessageId(evt) || evt?.messageId || null;

    console.log("[webhook] ARRIVE subtype=%j", subtype);

    if (!isNewInbound(evt)) {
      console.log("[webhook] IGNORE wrong_subtype");
      return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "wrong_subtype", subtype });
    }
    if (hasLoopHeader(evt)) {
      console.log("[webhook] IGNORE loop_header_present");
      return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "loop_header_present", subtype });
    }

    // Idempotency per message
    if (rawMessageId) {
      const idemKey = `alexio:idempotency:${rawMessageId}`;
      if (await kv.get(idemKey)) {
        console.log("[webhook] IGNORE idempotent messageId=%s", rawMessageId);
        return NextResponse.json({ ok: true, ignored: true, reason: "idempotent" });
      }
    }
    // Cooldown per thread
    if (objectId) {
      const cdKey = `alexio:cooldown:thread:${objectId}`;
      if (await kv.get(cdKey)) {
        console.log("[webhook] IGNORE cooldown threadId=%s", objectId);
        return NextResponse.json({ ok: true, ignored: true, reason: "cooldown" });
      }
    }

    // Try trivial places first
    let toEmail: string | null = null;
    const direct = [
      get(evt, ["recipient", "email"]),
      get(evt, ["message", "from", "email"]),
      get(evt, ["object", "message", "from", "email"]),
    ];
    for (const c of direct) { if (isEmail(c)) { toEmail = c; break; } }

    // Resolve via internal lookup when needed
    let via = "direct";
    let inboxId: string | number | null = null;
    let channelId: string | number | null = null;
    let inboxEmail: string | null = null;

    if (!toEmail) {
      if (!objectId) {
        console.log("[webhook] IGNORE no_email (no objectId)");
        return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "no_email_no_objectId", subtype });
      }
      const lookupUrl = `${SELF}/api/hubspot/lookup`;
      let lookupRes: Response;
      try {
        lookupRes = await postJson(lookupUrl, { objectId, messageId: evt?.messageId ?? null });
      } catch (e: any) {
        console.log("[webhook] ERROR fetch failed (lookup) %s", e?.message ?? "unknown");
        return NextResponse.json({ ok: false, error: "internal_lookup_fetch_failed" }, { status: 500 });
      }
      const lookup = await lookupRes.json().catch(() => ({}));
      if (lookupRes.ok && lookup?.email) {
        toEmail = lookup.email;
        via = `lookup:${lookup?.via || "unknown"}`;
        inboxId = lookup?.inboxId ?? null;
        channelId = lookup?.channelId ?? null;
        inboxEmail = lookup?.inboxEmail ?? null;
      } else {
        console.log("[webhook] IGNORE no_email (lookup failed) status=%s body=%j", lookupRes.status, lookup);
        return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "no_email_lookup_failed", subtype, lookup });
      }
    }

    // ---- Template selection (per inbox / channel) ----
    const chosen = pickTemplate({
      inboxEmail: inboxEmail ?? undefined,
      inboxId: inboxId ?? undefined,
      channelId: channelId ?? undefined,
    });
    const subject = chosen.subject;
    const html = (chosen.html || "").trim() ||
      `<p>Thanks for reaching out to Alex-IO. We received your message and will follow up shortly.</p><p>— Alex-IO</p>`;

    const inReplyTo = extractMessageId(evt);

    if (dryRun || !replyEnabled) {
      return NextResponse.json({
        ok: true, dryRun: true, wouldSend: true,
        toEmail, via, inReplyTo, subtype,
        template: { subject: subject ?? "(none)", htmlPreview: html.slice(0, 140) }
      });
    }

    // ---- Send via internal sender ----
    let sendRes: Response;
    try {
      sendRes = await postJson(SEND, {
        to: toEmail,
        html,
        subject,
        inReplyTo,
        references: inReplyTo ? [inReplyTo] : undefined,
      });
    } catch (e: any) {
      console.log("[webhook] ERROR fetch failed (send) %s", e?.message ?? "unknown");
      return NextResponse.json({ ok: false, error: "send_fetch_failed" }, { status: 500 });
    }

    if (!sendRes.ok) {
      const text = await sendRes.text().catch(() => "");
      console.log("[webhook] SEND FAIL to=%s status=%s ms=%d", toEmail, sendRes.status, Date.now() - startedAt);
      return NextResponse.json(
        { ok: false, error: "graph send failed", status: sendRes.status, details: text.slice(0, 1000) },
        { status: 502 }
      );
    }

    // Mark idempotency + cooldown
    if (rawMessageId) await kv.set(`alexio:idempotency:${rawMessageId}`, "1", Math.max(60, idemTtlMin * 60));
    if (objectId) await kv.set(`alexio:cooldown:thread:${objectId}`, "1", Math.max(60, cooldownMin * 60));

    console.log("[webhook] SENT to=%s via=%s inReplyTo=%s ms=%d", toEmail, via, inReplyTo ?? "-", Date.now() - startedAt);
    return NextResponse.json({ ok: true, sent: true, toEmail, via, inReplyTo, templateUsed: { subject: subject ?? "(none)" } });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
