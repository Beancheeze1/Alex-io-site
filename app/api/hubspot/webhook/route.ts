// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { pickTemplate } from "@/app/lib/templates";

export const dynamic = "force-dynamic";

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
  return String(headers["X-AlexIO-Responder"] ?? headers["x-alexio-responder"] ?? "").trim() === "1";
}
function isNewInbound(evt: any): boolean {
  const subscriptionType = String(evt?.subscriptionType ?? "");
  const changeFlag = String(evt?.changeFlag ?? "");
  const messageType = String(evt?.messageType ?? "");
  return (
    subscriptionType.includes("conversation.newMessage") ||
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
    if (!Array.isArray(events) || events.length === 0)
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });

    const evt = events[0];
    const objectId = evt?.objectId ?? evt?.threadId ?? null;
    const rawMessageId = extractMessageId(evt);

    if (!isNewInbound(evt))     return NextResponse.json({ ok: true, ignored: true, reason: "wrong_subtype" });
    if (hasLoopHeader(evt))     return NextResponse.json({ ok: true, ignored: true, reason: "loop_header_present" });
    if (rawMessageId) {
      const k = `alexio:idempotency:${rawMessageId}`;
      if (await kv.get(k))      return NextResponse.json({ ok: true, ignored: true, reason: "idempotent" });
    }
    if (objectId) {
      const k = `alexio:cooldown:thread:${objectId}`;
      if (await kv.get(k))      return NextResponse.json({ ok: true, ignored: true, reason: "cooldown" });
    }

    // Try easy spots
    let toEmail: string | null =
      get(evt, ["message", "from", "email"]) ||
      get(evt, ["object", "message", "from", "email"]) || null;
    if (toEmail && !isEmail(toEmail)) toEmail = null;

    // Lookup for sender + inbox hints
    let via = "direct";
    let inboxId: string | number | null = null;
    let channelId: string | number | null = null;
    let inboxEmail: string | null = null;

    if (!toEmail) {
      if (!objectId) return NextResponse.json({ ok: true, ignored: true, reason: "no_email_no_objectId" });
      const res = await postJson(`${SELF}/api/hubspot/lookup`, { objectId, messageId: evt?.messageId ?? null });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.email)
        return NextResponse.json({ ok: true, ignored: true, reason: "no_email_lookup_failed", lookup: data });
      toEmail = data.email;
      via = `lookup:${data?.via || "unknown"}`;
      inboxId = data?.inboxId ?? null;
      channelId = data?.channelId ?? null;
      inboxEmail = data?.inboxEmail ?? null;
    }

    // 🔹 Pick template (per inbox/pipeline)
    const tpl = pickTemplate({ inboxEmail: inboxEmail ?? undefined, inboxId: inboxId ?? undefined, channelId: channelId ?? undefined });
    const subject = tpl.subject;
    const html = (tpl.html || "").trim() ||
      `<p>Thanks for reaching out to Alex-IO. We received your message and will follow up shortly.</p><p>— Alex-IO</p>`;
    const inReplyTo = rawMessageId || undefined;

    if (dryRun || !replyEnabled) {
      return NextResponse.json({
        ok: true, dryRun: true, wouldSend: true,
        toEmail, via, inReplyTo,
        template: { subject: subject ?? "(none)", htmlPreview: html.slice(0, 140) }
      });
    }

    // Send
    const sendRes = await postJson(SEND, {
      to: toEmail,
      subject,
      html,
      inReplyTo,
      references: inReplyTo ? [inReplyTo] : undefined,
      // loop header added in msgraph route
    });
    if (!sendRes.ok) {
      const t = await sendRes.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "graph send failed", status: sendRes.status, details: t.slice(0, 1000) }, { status: 502 });
    }

    if (rawMessageId) await kv.set(`alexio:idempotency:${rawMessageId}`, "1", Math.max(60, idemTtlMin * 60));
    if (objectId)     await kv.set(`alexio:cooldown:thread:${objectId}`, "1", Math.max(60, cooldownMin * 60));

    console.log("[webhook] SENT to=%s via=%s inReplyTo=%s ms=%d", toEmail, via, inReplyTo ?? "-", Date.now() - startedAt);
    return NextResponse.json({ ok: true, sent: true, toEmail, via, inReplyTo, templateUsed: { subject: subject ?? "(none)" } });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
