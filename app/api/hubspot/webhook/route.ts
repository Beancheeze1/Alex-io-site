// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type DeliveryIdentifier =
  | { type?: string; value?: string }
  | null
  | undefined;

type SenderEntry = {
  senderField?: string; // "FROM" / "TO"
  deliveryIdentifier?: DeliveryIdentifier; // { type:"HS_EMAIL_ADDRESS", value:"someone@example.com" }
};

type HubSpotMessage = {
  id?: string;
  direction?: string; // sometimes "INBOUND"
  messageDirection?: string; // sometimes "INBOUND"
  from?: { email?: string };
  sender?: { email?: string; address?: string };
  recipient?: { email?: string };
  channel?: { from?: { email?: string } };
  senders?: SenderEntry[];
};

type HubSpotEvent = {
  subscriptionType?: string; // "conversation.newMessage"
  changeFlag?: string; // "NEW_MESSAGE"
  messageType?: string; // "MESSAGE"
  objectId?: number | string; // threadId
  // sometimes HubSpot includes these on the event:
  customerEmail?: string;
  fromEmail?: string;
  email?: string;
  sender?: string;
  deliveryIdentifier?: { type?: string; value?: string }[]; // rarely on the event
  subject?: string;
  text?: string;
};

function j(data: any, init?: number | ResponseInit) {
  const opts = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

const SELF_FROM = (process.env.MS_MAILBOX_FROM || "sales@alex-io.com").toLowerCase();

function isInboundEvent(ev: HubSpotEvent) {
  return (
    (ev.subscriptionType || "").toLowerCase() === "conversation.newmessage" &&
    (ev.changeFlag || "").toUpperCase() === "NEW_MESSAGE" &&
    (ev.messageType || "MESSAGE").toUpperCase() === "MESSAGE"
  );
}

function directEmailFromEvent(ev: HubSpotEvent): string | null {
  // check all the legacy event fields first
  const candidates: (string | undefined)[] = [
    ev.customerEmail,
    ev.fromEmail,
    ev.email,
    ev.sender,
    ev.deliveryIdentifier?.find((d) => d?.value)?.value, // if present on event (rare)
  ];
  const first = candidates.find((s) => !!s)?.trim()?.toLowerCase() || null;
  return first;
}

async function getHubspotAccessToken(): Promise<string> {
  const base = process.env.NEXT_PUBLIC_BASE_URL!;
  const r = await fetch(`${base}/api/hubspot/refresh`, { cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.log(`[webhook] hubspot refresh error ${r.status} ${t}`);
    throw new Error("hs_token_" + r.status);
  }
  const data = await r.json().catch(() => ({}));
  const tok = data?.access_token || data?.accessToken || data?.token;
  if (!tok) throw new Error("hs_token_missing");
  return tok;
}

function fromSendersArray(senders?: SenderEntry[]): string | null {
  if (!senders || !Array.isArray(senders)) return null;
  // Prefer the "FROM" senderField
  const fromEntry =
    senders.find((s) => (s.senderField || "").toUpperCase() === "FROM") || senders[0];

  const val = fromEntry?.deliveryIdentifier && (fromEntry.deliveryIdentifier as any).value;
  if (typeof val === "string" && val.includes("@")) return val.trim().toLowerCase();
  return null;
}

function firstInbound(messages: any): HubSpotMessage | null {
  const list: HubSpotMessage[] = messages?.results || messages?.messages || [];
  if (!Array.isArray(list) || !list.length) return null;
  const inbound =
    list.find((m) => {
      const d = (m.direction || m.messageDirection || "").toUpperCase();
      return d === "INBOUND";
    }) || list[0];
  return inbound || null;
}

async function emailFromThread(threadId: string | number): Promise<string | null> {
  const token = await getHubspotAccessToken();

  // newest-first
  const res = await fetch(
    `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages?limit=10&sort=createdAt&order=DESC`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.log(`[webhook] thread ${threadId} fetch error ${res.status} ${t}`);
    return null;
  }

  const data = await res.json().catch(() => ({}));
  const msg = firstInbound(data);
  if (!msg) return null;

  // 1) NEW SHAPE: senders[].deliveryIdentifier.value
  const viaSenders = fromSendersArray(msg.senders);
  if (viaSenders) return viaSenders;

  // 2) Legacy shapes as fallback
  const candidates: (string | undefined)[] = [
    msg?.from?.email,
    msg?.sender?.email,
    msg?.sender?.address,
    msg?.channel?.from?.email,
    msg?.recipient?.email,
  ];
  const found = candidates.find((s) => !!s)?.trim()?.toLowerCase() || null;
  return found;
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dryRun = searchParams.get("dryRun") === "1";

    let events: HubSpotEvent[] = [];
    try {
      const body = await req.json();
      events = Array.isArray(body) ? body : body ? [body] : [];
    } catch {
      return j({ ok: false, error: "invalid_json" }, 400);
    }

    console.log(`[webhook] received events=${events.length}`);
    if (!events.length) return j({ ok: true, skipped: true, reason: "no_events" });

    // Find the first inbound event and resolve an email
    let toEmail: string | null = null;
    let selected: HubSpotEvent | null = null;

    for (const ev of events) {
      if (!isInboundEvent(ev)) continue;

      // Try direct fields first
      let email = directEmailFromEvent(ev);

      // If not present, resolve via thread (new HubSpot shapes place it there)
      if (!email && ev.objectId != null) {
        email = await emailFromThread(String(ev.objectId));
      }

      if (email && !email.includes(SELF_FROM)) {
        toEmail = email;
        selected = ev;
        break;
      }
    }

    if (!toEmail) {
      console.log("[webhook] no_valid_inbound (missing/loop email)");
      return j({ ok: true, skipped: true, reason: "no_valid_inbound" });
    }

    // Build a simple reply
    const subject = selected?.subject ? `Re: ${selected.subject}` : "Re: your message";
    const text =
      selected?.text ||
      "Thanks for your message — this is an automated reply from Alex-IO while we connect you with a human.";

    if (dryRun) {
      console.log("[webhook] dryRun → to=", toEmail);
      return j({ ok: true, dryRun: true, to: toEmail, subject, text }, 200);
    }

    // Forward to your MS Graph sender
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: toEmail, subject, text }),
    });

    const ok = res.status === 202 || res.ok;
    const data = await res.json().catch(() => ({}));
    console.log(`[webhook] send to=${toEmail} status=${res.status}`);
    return j({ ok, status: res.status, data }, ok ? 200 : res.status);
  } catch (err: any) {
    console.error("[webhook] error", err);
    return j({ ok: false, error: String(err?.message || err) }, 500);
  }
}
