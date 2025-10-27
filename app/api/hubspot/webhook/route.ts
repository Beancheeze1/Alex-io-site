// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Minimal Path-A HubSpot webhook handler:
 * 1. Accepts POST (array of events)
 * 2. Detects NEW inbound customer messages
 * 3. Sends them to /api/ms/send (Graph App)
 * 4. Safe to call with ?dryRun=1
 */

type HubSpotEvent = {
  eventId?: number;
  portalId?: number;
  subscriptionId?: number;
  subscriptionType?: string;
  occurredAt?: number;
  objectId?: number;
  messageId?: string;
  messageType?: string;
  changeFlag?: string;
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

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  let events: HubSpotEvent[] = [];

  try {
    const body = await req.json();
    if (Array.isArray(body)) events = body;
    else if (body && typeof body === "object") events = [body];
  } catch (err) {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!events.length) return json({ ok: true, skipped: true, reason: "no_events" });

  const outbound: HubSpotEvent[] = events.filter(
    (e) =>
      e.subscriptionType?.toLowerCase() === "conversation.newmessage" &&
      e.changeFlag?.toUpperCase() === "NEW_MESSAGE" &&
      e.customerEmail &&
      !e.customerEmail.toLowerCase().includes("sales@alex-io.com")
  );

  if (!outbound.length)
    return json({ ok: true, skipped: true, reason: "no_valid_inbound" });

  if (dryRun)
    return json({ ok: true, dryRun: true, sample: outbound[0] });

  // Send each inbound message through Microsoft Graph send endpoint
  let sent: any[] = [];
  for (const e of outbound) {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/ms/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: e.customerEmail,
          subject: `Re: ${e.subject || "Your message"}`,
          text: e.text
            ? `Hi — thanks for your message!\n\n${e.text}`
            : "Thanks for reaching out.",
        }),
      }
    );

    const data = await res.json().catch(() => ({}));
    sent.push({ email: e.customerEmail, status: res.status, data });
  }

  return json({ ok: true, sent });
}
