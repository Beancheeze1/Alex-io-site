import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Minimal HubSpot webhook:
 *  - Accepts POSTs with an array of events
 *  - Filters to conversation.newMessage / NEW_MESSAGE
 *  - Extracts sender email (customer) and composes a simple reply
 *  - Calls our internal /api/ms/send
 *  - Supports ?dryRun=1 to avoid actually sending
 */

/* ----------------- Types ----------------- */

type HubSpotEvent = {
  // core IDs
  eventId?: number | null;
  portalId?: number | null;
  subscriptionId?: number | null;

  // kinds
  subscriptionType?: string | null; // "conversation.newMessage"
  occurredAt?: number | null;
  objectId?: number | null; // threadId (from earlier pipeline)
  messageId?: string | null;
  messageType?: "MESSAGE" | string | null; // MESSAGE
  changeFlag?: "NEW_MESSAGE" | string | null;

  // emails HubSpot sometimes sets to null
  customerEmail?: string | null;
  fromEmail?: string | null;
  email?: string | null;
  sender?: string | null;

  // misc slot we used earlier
  html?: string | null;
  subject?: string | null;
  text?: string | null;

  // lenient envelope we might derive when we fetch thread (not used here)
  envelope?: {
    dir?: "INCOMING" | "OUTGOING" | null;
    from?: string | null;
    recip?: string | null;
  } | null;
};

/* ----------------- Helpers ----------------- */

// Normalize HubSpot nulls to undefined so they match string | undefined
const asU = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

// String guard
const hasText = (s: string | null | undefined): s is string =>
  typeof s === "string" && s.trim().length > 0;

// Very small in-memory dedupe for this process (prevents resend on HS retries)
const seen = new Set<string>();
const dedupeKey = (e: HubSpotEvent) =>
  [
    asU(e.eventId)?.toString(),
    asU(e.messageId),
    asU(e.objectId)?.toString(),
  ]
    .filter(Boolean)
    .join(":");

/* ----------------- Config ----------------- */

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.VERCEL_URL?.startsWith("http")
    ? (process.env.VERCEL_URL as string)
    : `https://${process.env.VERCEL_URL}`;

const FROM_ADDR = (process.env.MS_MAILBOX_FROM || "sales@alex-io.com").toLowerCase();

/* ----------------- Util JSON wrapper ----------------- */

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

/* ----------------- Core logic ----------------- */

function isInboundNewMessage(e: HubSpotEvent): boolean {
  // Permit minimal looseness but still target what we want
  const isConv = asU(e.subscriptionType)?.toLowerCase() === "conversation.newmessage";
  const isNew = asU(e.changeFlag)?.toUpperCase() === "NEW_MESSAGE";
  const isMsg = asU(e.messageType)?.toUpperCase() === "MESSAGE";
  return !!(isConv && isNew && isMsg);
}

function extractSenderEmail(e: HubSpotEvent): string | undefined {
  // Try multiple places; HS often sets some to null
  const candidates = [
    asU(e.customerEmail),
    asU(e.email),
    asU(e.fromEmail),
    asU(e.sender),
    asU(e.envelope?.from),
  ].filter(hasText);

  const first = candidates[0]?.trim().toLowerCase();
  if (!first) return undefined;

  // Loop-protection: do not reply to ourselves
  if (first === FROM_ADDR) return undefined;

  return first;
}

function buildSubject(e: HubSpotEvent): string {
  const raw = asU(e.subject) || "Re: your message";
  // Ensure 'Re:' prefix only once
  return /^re:/i.test(raw) ? raw : `Re: ${raw}`;
}

function buildText(e: HubSpotEvent): string {
  if (hasText(e.text)) return e.text!.trim();
  return "Thanks for your message — we'll get back to you shortly.";
}

/* ----------------- Route handlers ----------------- */

/**
 * Optional GET ping: /api/hubspot/webhook?dryRun=1
 * (kept for parity with your earlier testing style)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";
  return json({ ok: true, route: "/api/hubspot/webhook", dryRun }, 200);
}

/**
 * HubSpot POST webhook handler
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  let events: HubSpotEvent[] = [];
  try {
    const body = await req.json();
    // HS posts an array; guard if a single object arrives
    events = Array.isArray(body) ? (body as HubSpotEvent[]) : [body as HubSpotEvent];
  } catch (err) {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // Slim log hint (not PII heavy)
  console.log("[webhook] received events=%d", events.length);

  // Filter relevant events
  const targets = events.filter(isInboundNewMessage);

  if (targets.length === 0) {
    return json({ ok: true, skipped: true, reason: "no_events" }, 200);
  }

  // Process each event; stop at first successful send
  for (const e of targets) {
    const key = dedupeKey(e);
    if (key && seen.has(key)) {
      console.log("[webhook] duplicate_skipped %s", key);
      continue;
    }

    const to = extractSenderEmail(e);
    if (!to) {
      console.log(
        "[webhook] no_valid_inbound (missing/loop email) for objectId=%s messageId=%s",
        asU(e.objectId),
        asU(e.messageId)
      );
      continue;
    }

    const subject = buildSubject(e);
    const text = buildText(e);

    if (dryRun) {
      console.log("[webhook] DRYRUN to=%s subject=%j", to, subject);
      seen.add(key);
      // Keep iterating to catch other events, but report first preview
      // Returning immediately would also be acceptable
      continue;
    }

    // Call our internal Graph sender
    const sendUrl = `${BASE_URL}/api/ms/send`;
    try {
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, text }),
      });

      // Accept 200/202
      if (res.ok || res.status === 202) {
        console.log(
          "[webhook] send to=%s status=%d",
          to,
          res.status
        );
        seen.add(key);
        // We can continue to send for other events in the same batch
        // (or return immediately if one is enough)
        continue;
      } else {
        const t = await res.text().catch(() => "");
        console.warn(
          "[webhook] send_failed to=%s status=%d body=%s",
          to,
          res.status,
          t?.slice(0, 300)
        );
      }
    } catch (err) {
      console.warn("[webhook] send_exception to=%s err=%o", to, err);
    }
  }

  return json({ ok: true, processed: targets.length }, 200);
}
