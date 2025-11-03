// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * HubSpot Webhook endpoint
 * - Logs ARRIVE always
 * - Accepts both array/object payloads (HubSpot test vs live)
 * - Dry run: ?dryRun=1 echoes a stub result and 200
 * - Extracts fromEmail + messageId (inReplyTo) if present
 * - If no email -> logs IGNORE no_email and 200 (so HubSpot stays green)
 * - Otherwise calls our internal msgraph sender
 */

type HSMessage = {
  subscriptionType?: string;
  eventType?: string | null;
  changeFlag?: string;
  messageType?: string;
  message?: {
    from?: { email?: string | null };
  };
  headers?: Record<string, string>;
};

function normalize(body: unknown): HSMessage {
  if (Array.isArray(body)) {
    // HubSpot "Test" button sends an array with one item
    return (body[0] ?? {}) as HSMessage;
  }
  return (body ?? {}) as HSMessage;
}

function pickInReplyTo(h: Record<string, string> | undefined) {
  if (!h) return undefined;
  // HubSpot lower/varied casing happens; normalize keys
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) map[k.toLowerCase()] = v;
  return (
    map["message-id"] ||
    map["messageid"] ||
    map["in-reply-to"] ||
    map["references"] // last resort
  );
}

async function postJson(url: string, payload: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    // keep this dynamic so we don't cache
    cache: "no-store",
  });
  let txt = "";
  try {
    txt = await res.text();
  } catch {}
  return { status: res.status, ok: res.ok, text: txt };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("dryRun")) {
    console.log(`[webhook] DRYRUN GET ok`);
    return NextResponse.json({ ok: true, dryRun: true });
  }
  return NextResponse.json({ ok: true, method: "GET" });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const isDry = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";

  let raw: any = null;
  try {
    raw = await req.json();
  } catch {
    console.log(`[webhook] ERROR invalid json body`);
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const msg = normalize(raw);

  // --- ARRIVE log FIRST (this is what you were seeing when green)
  console.log(
    `[webhook] ARRIVE subtype=${JSON.stringify({
      subscriptionType: msg.subscriptionType,
      eventType: msg.eventType ?? null,
      changeFlag: msg.changeFlag,
      messageType: msg.messageType,
    })}`
  );

  if (isDry) {
    console.log(`[webhook] DRYRUN body=${Array.isArray(raw) ? "array[1]" : "object"}`);
    return NextResponse.json({ ok: true, dryRun: true, bodyKind: Array.isArray(raw) ? "array" : "object" });
  }

  const toEmail = msg?.message?.from?.email ?? null;
  const inReplyTo = pickInReplyTo(msg?.headers);

  if (!toEmail) {
    console.log(`[webhook] IGNORE no_email subtype=${JSON.stringify({ subscriptionType: msg.subscriptionType, messageType: msg.messageType })}`);
    // Return 200 so HubSpot stays green
    return NextResponse.json({ ok: true, ignored: true, reason: "no_email" });
  }

  // Build a minimal template (this matched the “plain reply worked” period)
  const subject = `[Alex-IO] Default Auto-Reply`;
  const text = `Thanks for contacting Alex-IO. We received your note and will reply soon.\n\n— Alex-IO`;

  // call our internal msgraph sender (was working during the green window)
  const sendRes = await postJson(`${url.origin}/api/msgraph/send`, {
    to: toEmail,
    subject,
    text,
    inReplyTo, // safe to be undefined
    // allow the send route to handle its own dryRun if needed
  });

  if (!sendRes.ok) {
    console.log(
      `[webhook] ERROR fetch failed to /api/msgraph/send status=${sendRes.status} body=${sendRes.text?.slice(0, 400)}`
    );
    // still 200 to HubSpot to avoid retries, but include a flag for our admin views
    return NextResponse.json({ ok: false, error: "msgraph_send_failed", status: sendRes.status }, { status: 200 });
  }

  console.log(
    `[webhook] SENT to=${toEmail} via=lookup:deep inReplyTo=${inReplyTo ?? "(none)"} ms=${(sendRes.text?.length ?? 0)}`
  );
  return NextResponse.json({ ok: true, sent: true, toEmail: toEmail, graph: { status: sendRes.status, dryRun: false } });
}
