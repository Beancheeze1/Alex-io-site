// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

/**
 * Alex-IO Webhook — robust sender extraction + verbose logs
 *
 * Finds sender email via:
 *  1) message.from.email / sender.email / originator.email (and under object.message.*)
 *  2) headers["From"] / headers["Reply-To"] (parse RFC5322 "Name <addr@example.com>")
 *  3) deep-scan for the first non-alex-io email in the entire event
 *
 * ENVs:
 *   REPLY_ENABLED=true
 *   INTERNAL_SEND_URL=https://alex-io-bot.onrender.com/api/msgraph/send
 */

function asBool(v: unknown) { return String(v ?? "").toLowerCase() === "true"; }
function get(o: any, path: string[]) {
  return path.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);
}
function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function parseEmailFromHeader(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Try <addr@domain>
  const m = v.match(/<\s*([^>]+@[^>]+)\s*>/);
  if (m?.[1] && isEmail(m[1])) return m[1].trim();
  // Fallback: bare address in header value
  const bare = v.trim();
  if (isEmail(bare)) return bare;
  return null;
}
function deepFindEmails(x: any, out: Set<string>) {
  if (x == null) return;
  const t = typeof x;
  if (t === "string") {
    // collect all email-like substrings in this string
    for (const m of x.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
      const e = m[0].toLowerCase();
      out.add(e);
    }
    return;
  }
  if (t !== "object") return;
  if (Array.isArray(x)) { for (const v of x) deepFindEmails(v, out); return; }
  for (const k of Object.keys(x)) deepFindEmails((x as any)[k], out);
}

function extractEmail(evt: any) {
  const headers =
    get(evt, ["message", "headers"]) ||
    get(evt, ["object", "message", "headers"]) ||
    {};

  const candidates: (string | null | undefined)[] = [
    get(evt, ["recipient", "email"]),
    get(evt, ["message", "from", "email"]),
    get(evt, ["message", "sender", "email"]),
    get(evt, ["message", "originator", "email"]),
    get(evt, ["object", "message", "from", "email"]),
    get(evt, ["object", "message", "sender", "email"]),
    get(evt, ["object", "message", "originator", "email"]),
    get(evt, ["object", "from", "email"]),
    parseEmailFromHeader(headers?.["From"]),
    parseEmailFromHeader(headers?.["from"]),
    parseEmailFromHeader(headers?.["Reply-To"]),
    parseEmailFromHeader(headers?.["reply-to"]),
  ];

  for (const c of candidates) if (isEmail(c)) return { email: c, via: "direct/headers" };

  // Deep scan fallback
  const all = new Set<string>();
  deepFindEmails(evt, all);
  const pick = [...all].find(e => !e.endsWith("@alex-io.com")); // avoid our own mailbox
  if (pick) return { email: pick, via: "deep-scan" };

  return { email: null as string | null, via: "none" };
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

    console.log("[webhook] ARRIVE subtype=%j", subtype);

    if (!isNewInbound(evt)) {
      console.log("[webhook] IGNORE wrong_subtype");
      return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "wrong_subtype", subtype });
    }

    if (hasLoopHeader(evt)) {
      console.log("[webhook] IGNORE loop_header_present");
      return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "loop_header_present", subtype });
    }

    const { email: toEmail, via } = extractEmail(evt);
    const inReplyTo = extractMessageId(evt);

    if (!toEmail) {
      const messageKeys = Object.keys(evt?.message || evt?.object?.message || {});
      const topKeys = Object.keys(evt || {});
      console.log("[webhook] IGNORE no_email (checked headers & deep-scan) subtype=%j", subtype);
      return NextResponse.json({
        ok: true,
        dryRun,
        ignored: true,
        reason: "no_email",
        subtype,
        messageKeys,
        topKeys,
      });
    }

    if (dryRun || !replyEnabled) {
      console.log("[webhook] DRYRUN to=%s via=%s inReplyTo=%s", toEmail, via, inReplyTo ?? "-");
      return NextResponse.json({ ok: true, dryRun: true, wouldSend: true, toEmail, via, inReplyTo, subtype });
    }

    const html =
      `<p>Thanks for reaching out! We received your message and will follow up shortly.</p>` +
      `<p>— Alex-IO</p>`;

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
      console.log("[webhook] SEND FAIL to=%s status=%s", toEmail, res.status);
      return NextResponse.json(
        { ok: false, error: "sendMail fetch failed", status: res.status, details: text.slice(0, 1000), toEmail, via, inReplyTo, subtype },
        { status: 502 }
      );
    }

    console.log("[webhook] SENT to=%s via=%s inReplyTo=%s", toEmail, via, inReplyTo ?? "-");
    return NextResponse.json({ ok: true, sent: true, toEmail, via, inReplyTo, subtype });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
