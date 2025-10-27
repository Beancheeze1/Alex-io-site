// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Minimal, Path-A webhook that:
 * 1) Accepts HubSpot webhook POSTs (array of events)
 * 2) Detects NEW inbound customer messages only
 * 3) Builds a simple reply (or uses provided replyText/replyHtml if present)
 * 4) Sends via our internal /api/ms/send endpoint (Graph App-Only)
 *
 * Safe to call with ?dryRun=1 to avoid sending.
 */

type HubSpotEvent = {
  eventId?: number;
  portalId?: number;
  subscriptionId?: number;
  subscriptionType?: string; // e.g. "conversation.newMessage"
  occurredAt?: number;
  objectId?: number; // threadId in our earlier logic
  messageId?: string;
  messageType?: "MESSAGE" | string;
  changeFlag?: "NEW_MESSAGE" | string;
  // permissive allows from our prior pipeline
  customerEmail?: string;
  subject?: string;
  text?: string;
  html?: string;
  fromEmail?: string;
};

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

export async function GET(req: Request) {
  const dry = new URL(req.url).searchParams.get("dryRun") === "1";
  if (dry) return json({ ok: true, route: "/api/hubspot/webhook", dryRun: true });
  return json({ ok: true, route: "/api/hubspot/webhook", hint: "POST webhook events here" });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // HubSpot posts an array of events. Normalize to the first/newest.
  const events: HubSpotEvent[] = Array.isArray(payload) ? (payload as any) : [];
  if (!events.length) {
    return json({ ok: true, skipped: true, reason: "no_events" });
  }

  const ev = events[0];

  // Guard: only act on NEW inbound customer messages
  const isNewMessage = (ev.changeFlag || "").toUpperCase() === "NEW_MESSAGE";
  const looksLikeConversation = (ev.subscriptionType || "").includes("conversation");
  if (!isNewMessage || !looksLikeConversation) {
    return json({ ok: true, skipped: true, reason: "not_new_inbound_message", event: ev.subscriptionType });
  }

  // Extract critical fields (our earlier responder already computed these;
  // we also fall back to permissive/optional properties if provided)
  const customerEmail =
    (ev.customerEmail || ev.fromEmail || "").trim();
  const subject =
    (ev.subject || "Thanks for reaching out — Alex-IO").trim();

  // Prefer explicit html/text delivered by our pipeline; else make a tiny template
  const replyHtml =
    (ev.html as string) ||
    `<p>Hi there — thanks for contacting Alex-IO.</p>
     <p>We received your message and will follow up shortly.</p>
     <p>— Alex-IO Bot</p>`;

  const replyText =
    (ev.text as string) ||
    `Hi there — thanks for contacting Alex-IO.
We received your message and will follow up shortly.
— Alex-IO Bot`;

  // Basic inbound safety: require a customer email not matching our from mailbox
  const fromMailbox = process.env.MS_MAILBOX_FROM || "";
  if (!customerEmail || (fromMailbox && customerEmail.toLowerCase() === fromMailbox.toLowerCase())) {
    return json({
      ok: true,
      skipped: true,
      reason: "missing_or_self_email",
      customerEmail,
    });
  }

  // Dry run short-circuit
  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      to: customerEmail,
      subject,
      preview: replyText.slice(0, 160),
    });
  }

  // Send via our internal Graph endpoint (already working)
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: customerEmail,
        subject,
        // choose HTML if available; otherwise send text
        html: replyHtml,
        text: replyHtml ? undefined : replyText,
      }),
      // Keep default timeout behavior; any failure will be bubbled below
    });

    if (!res.ok) {
      const detail = await safeText(res);
      return json(
        { ok: false, error: "graph_send_failed", status: res.status, detail },
        { status: 502 }
      );
    }

    const sent = await res.json();
    return json({ ok: true, sent });
  } catch (err: any) {
    return json({ ok: false, error: "send_exception", detail: String(err) }, { status: 500 });
  }
}

async function safeText(r: Response) {
  try {
    return await r.text();
  } catch {
    return "<no body>";
  }
}
