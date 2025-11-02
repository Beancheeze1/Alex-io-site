// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Alex-IO Webhook (Path-A minimal, production-safe)
 *
 * • Accepts "new inbound" signals from HubSpot Conversations:
 *   - subscriptionType: "conversation.newMessage"
 *   - OR changeFlag: "NEW_MESSAGE"
 *   - OR messageType: "MESSAGE"
 *   - OR eventType contains "newMessage"
 *
 * • Loop protection: if original message has X-AlexIO-Responder: 1, skip.
 * • Extracts customer email + Message-Id defensively.
 * • Calls internal Graph sender to reply from sales@alex-io.com.
 *
 * Env:
 *   REPLY_ENABLED       = "true" to allow live sends (else dry behavior)
 *   INTERNAL_SEND_URL   = optional override to bypass Cloudflare, e.g.
 *                         https://alex-io-bot.onrender.com/api/msgraph/send
 */

function asBool(v: unknown): boolean {
  return String(v ?? "").toLowerCase() === "true";
}
function validEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}
function get(obj: any, path: string[]): any {
  return path.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), obj);
}

function extractEmail(evt: any): string | null {
  const candidates = [
    get(evt, ["recipient", "email"]),
    get(evt, ["message", "from", "email"]),
    get(evt, ["object", "message", "from", "email"]),
    get(evt, ["object", "from", "email"]),
  ];
  for (const c of candidates) if (validEmail(c)) return c;
  return null;
}

function extractMessageId(evt: any): string | null {
  const headers =
    get(evt, ["message", "headers"]) ||
    get(evt, ["object", "message", "headers"]) ||
    {};
  const mid =
    headers["Message-Id"] ||
    headers["message-id"] ||
    headers["MESSAGE-ID"] ||
    evt?.messageId ||
    evt?.object?.messageId ||
    null;
  return typeof mid === "string" && mid.length > 6 ? mid : null;
}

function hasLoopHeader(evt: any): boolean {
  const headers =
    get(evt, ["message", "headers"]) ||
    get(evt, ["object", "message", "headers"]) ||
    {};
  const v =
    headers["X-AlexIO-Responder"] ||
    headers["x-alexio-responder"] ||
    headers["X-ALEXIO-RESPONDER"] ||
    "";
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
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const replyEnabled = asBool(process.env.REPLY_ENABLED);

    const events = (await req.json()) as any[];
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });
    }

    // Path-A: handle only the first event
    const evt = events[0];

    const debug = {
      subscriptionType: evt?.subscriptionType ?? null,
      eventType: evt?.eventType ?? null,
      changeFlag: evt?.changeFlag ?? null,
      messageType: evt?.messageType ?? null,
    };

    if (!isNewInbound(evt)) {
      return NextResponse.json({
        ok: true,
        dryRun,
        ignored: true,
        reason: "wrong_subtype",
        debug,
      });
    }

    if (hasLoopHeader(evt)) {
      return NextResponse.json({
        ok: true,
        dryRun,
        ignored: true,
        reason: "loop_header_present",
        debug,
      });
    }

    const toEmail = extractEmail(evt);
    const inReplyTo = extractMessageId(evt);
    if (!toEmail) {
      return NextResponse.json({
        ok: true,
        dryRun,
        ignored: true,
        reason: "no_email",
        debug,
      });
    }

    if (dryRun || !replyEnabled) {
      console.log("[webhook] DRYRUN to=%s inReplyTo=%s", toEmail, inReplyTo ?? "-");
      return NextResponse.json({
        ok: true,
        dryRun: true,
        wouldSend: true,
        toEmail,
        inReplyTo,
        debug,
      });
    }

    // Compose a simple acknowledgement (swap to your template when ready)
    const html =
      `<p>Thanks for reaching out! We received your message and will follow up shortly.</p>` +
      `<p>— Alex-IO</p>`;

    // Use override if provided (bypasses Cloudflare); else same host
    const override = process.env.INTERNAL_SEND_URL; // e.g., https://alex-io-bot.onrender.com/api/msgraph/send
    const sendUrl = override || new URL("/api/msgraph/send", url).toString();

    const res = await postJson(sendUrl, {
      to: toEmail,
      html,
      inReplyTo,
      references: inReplyTo ? [inReplyTo] : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "sendMail fetch failed", details: text.slice(0, 2000), toEmail, inReplyTo, debug },
        { status: 502 }
      );
    }

    console.log("[webhook] to=%s inReplyTo=%s dry=%s", toEmail, inReplyTo ?? "-", false);
    return NextResponse.json({ ok: true, sent: true, toEmail, inReplyTo, debug });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
