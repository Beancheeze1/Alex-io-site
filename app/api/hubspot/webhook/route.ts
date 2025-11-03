// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";   // don't cache
export const runtime = "nodejs";          // ensure Node runtime (not edge)

/**
 * HubSpot Webhook endpoint
 * - GET → 405 (health sanity)
 * - POST:
 *    • supports object or array payloads (HubSpot test vs live)
 *    • ?dryRun=1 → echo only, no side-effects
 *    • extracts fromEmail + messageId if present
 *    • if no email → logs IGNORE no_email and returns 200 (keeps HubSpot happy)
 */

type HSMessage = {
  subscriptionType?: string;
  eventType?: string | null;
  changeFlag?: string;
  messageType?: string;
};

type HSEnvelope = {
  message?: { from?: { email?: string | null } };
  headers?: Record<string, string>;
  messageId?: string;
} & HSMessage;

function safeParse<T = any>(txt: string): T | null {
  try {
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

function pickFirstEvent(body: any): HSEnvelope | null {
  if (!body) return null;
  if (Array.isArray(body)) return (body[0] as HSEnvelope) ?? null;
  return body as HSEnvelope;
}

function pickSubType(e: HSEnvelope | null): string {
  if (!e) return "";
  const base: HSMessage = e;
  return JSON.stringify({
    subscriptionType: base.subscriptionType ?? "",
    eventType: base.eventType ?? "",
    changeFlag: base.changeFlag ?? "",
    messageType: base.messageType ?? "",
  });
}

function pickFromEmail(e: HSEnvelope | null): string | undefined {
  return e?.message?.from?.email ?? undefined;
}

function pickMessageId(e: HSEnvelope | null): string | undefined {
  // Prefer explicit field; fall back to common header keys
  if (e?.messageId) return e.messageId;
  const h = e?.headers;
  if (!h) return undefined;
  return (
    h["Message-Id"] ||
    h["Message-ID"] ||
    h["message-id"] ||
    h["MessageId"] ||
    h["messageId"]
  );
}

// ---------------- GET → 405 ----------------
export async function GET() {
  return NextResponse.json({ ok: false, method: "GET" }, { status: 405 });
}

// ---------------- POST ----------------
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";

  // Read raw body once
  const raw = await req.text();
  if (!raw) {
    // empty body → still return 200 so HubSpot does not retry forever
    console.log("[webhook] ERROR empty body");
    return NextResponse.json(
      { ok: false, error: "empty body" },
      { status: 200 }
    );
  }

  const body = safeParse<any>(raw);
  const event = pickFirstEvent(body);
  const subtype = pickSubType(event);

  console.log("[webhook] ARRIVE subtype=%s", subtype);

  if (dryRun) {
    // echo back helpful info
    return NextResponse.json(
      { ok: true, dryRun: true, subtype, note: "dryRun=1 -> echo only" },
      { status: 200 }
    );
  }

  const fromEmail = pickFromEmail(event);
  const messageId = pickMessageId(event);

  if (!fromEmail) {
    console.log("[webhook] IGNORE no_email subtype=%s", subtype);
    // Return 200 so HubSpot marks the attempt as successful.
    return NextResponse.json(
      { ok: true, ignored: true, reason: "no_email", subtype },
      { status: 200 }
    );
  }

  // At this point we've positively identified the sender address.
  // If you want immediate reply here, you can call your msgraph/send route.
  // For now we ACK only; orchestration handles the reply flow.
  console.log(
    "[webhook] RECEIVED from=%s inReplyTo=%s subtype=%s",
    fromEmail,
    messageId ?? "",
    subtype
  );

  return NextResponse.json(
    {
      ok: true,
      received: true,
      fromEmail,
      inReplyTo: messageId ?? null,
      subtype,
    },
    { status: 200 }
  );
}
