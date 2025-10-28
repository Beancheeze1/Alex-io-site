// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type HubSpotEvent = {
  subscriptionType?: string;          // "conversation.newMessage"
  changeFlag?: string;                // "NEW_MESSAGE"
  messageType?: string;               // "MESSAGE"
  objectId?: number | string;         // threadId
  // sometimes HubSpot includes one of these:
  customerEmail?: string;
  fromEmail?: string;
  email?: string;
  sender?: { email?: string; address?: string };
  recipient?: { email?: string };
  channel?: { from?: { email?: string } };
  // optional decorations we pass through:
  subject?: string;
  text?: string;
  html?: string;
};

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

const SELF_FROM = (process.env.MS_MAILBOX_FROM || "sales@alex-io.com").toLowerCase();

function looksLikeInbound(e: HubSpotEvent) {
  return (
    (e.subscriptionType || "").toLowerCase() === "conversation.newmessage" &&
    (e.changeFlag || "").toUpperCase() === "NEW_MESSAGE" &&
    (e.messageType || "MESSAGE").toUpperCase() === "MESSAGE"
  );
}

// Try to pull an email directly from the event (HubSpot uses many shapes)
function extractEmailFromEvent(e: HubSpotEvent): string | null {
  const candidates = [
    e.customerEmail,
    e.fromEmail,
    e.email,
    e?.sender?.email,
    e?.sender?.address,
    e?.recipient?.email,
    e?.channel?.from?.email,
  ]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());

  const first = candidates.find(Boolean) || null;
  return first;
}

// Redact function for safe logging
function redactEmail(s?: string | null) {
  if (!s) return s;
  const at = s.indexOf("@");
  if (at <= 1) return s; // nothing to redact
  return s[0] + "…" + s.slice(at);
}

// Minimal snapshot of the event for debug only when needed
function snapshotEvent(e: HubSpotEvent) {
  return {
    sub: e.subscriptionType,
    flag: e.changeFlag,
    msgType: e.messageType,
    objectId: e.objectId,
    customerEmail: redactEmail(e.customerEmail?.toLowerCase() || null),
    fromEmail: redactEmail(e.fromEmail?.toLowerCase() || null),
    email: redactEmail((e as any).email?.toLowerCase?.() || null),
    sender: redactEmail(e?.sender?.email || e?.sender?.address || null),
    channelFrom: redactEmail(e?.channel?.from?.email || null),
  };
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
  if (!tok) {
    console.log("[webhook] hubspot refresh returned no access_token", data);
    throw new Error("hs_token_missing");
  }
  return tok;
}

// Fetch latest messages on a thread; return first inbound + a tiny envelope for debug
async function resolveEmailFromThread(threadId: string | number): Promise<{ email: string | null; envelope?: any }> {
  const token = await getHubspotAccessToken();
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages?limit=10&sort=createdAt&order=DESC`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.log(`[webhook] thread fetch ${threadId} error ${r.status} ${t}`);
    return { email: null };
  }
  const data = await r.json().catch(() => ({}));
  const msgs: any[] = data?.results || data?.messages || [];

  // find newest inbound
  const inbound = msgs.find((m) => {
    const dir = (m?.direction || m?.messageDirection || "").toUpperCase();
    const type = (m?.type || "").toUpperCase();
    return dir === "INBOUND" || type === "INBOUND";
  }) || msgs[0];

  if (!inbound) return { email: null };

  const candidates = [
    inbound?.from?.email,
    inbound?.sender?.email,
    inbound?.sender?.address,
    inbound?.channel?.from?.email,
    inbound?.recipient?.email,
  ]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());

  const email = candidates.find(Boolean) || null;

  // compact envelope for log if needed
  const envelope = {
    dir: (inbound?.direction || inbound?.messageDirection || "").toUpperCase(),
    from: redactEmail(
      inbound?.from?.email ||
        inbound?.sender?.email ||
        inbound?.sender?.address ||
        inbound?.channel?.from?.email ||
        null
    ),
    recip: redactEmail(inbound?.recipient?.email || null),
  };

  return { email, envelope };
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  let events: HubSpotEvent[] = [];
  try {
    const body = await req.json();
    events = Array.isArray(body) ? body : body ? [body] : [];
  } catch {
    console.log("[webhook] invalid_json");
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  console.log(`[webhook] received events=${events.length}`);
  if (!events.length) return json({ ok: true, skipped: true, reason: "no_events" });

  const candidates = events.filter(looksLikeInbound);
  if (!candidates.length) {
    console.log("[webhook] no_valid_inbound (shape)");
    return json({ ok: true, skipped: true, reason: "no_valid_inbound" });
  }

  const resolved = await Promise.all(
    candidates.map(async (e) => {
      let email = extractEmailFromEvent(e);
      let envelope: any | undefined;

      if (!email && e.objectId != null) {
        const threadId = String(e.objectId);
        const r = await resolveEmailFromThread(threadId);
        email = r.email;
        envelope = r.envelope;
        if (!email) {
          console.log("[webhook] missing email after thread lookup", {
            event: snapshotEvent(e),
            threadId,
            envelope,
          });
        }
      }

      return { ...e, _resolvedEmail: email, _envelope: envelope };
    })
  );

  // loop protection & missing email filter (use env mailbox)
  const outbound = resolved.filter(
    (e) => e._resolvedEmail && !e._resolvedEmail!.includes(SELF_FROM)
  );

  if (!outbound.length) {
    console.log("[webhook] no_valid_inbound (missing/loop email)");
    return json({
      ok: true,
      skipped: true,
      reason: "no_valid_inbound",
      note: "no customer email found on events or loop-protected",
    });
  }

  if (dryRun) {
    console.log("[webhook] DRYRUN to=" + outbound[0]._resolvedEmail);
    return json({ ok: true, dryRun: true, sample: outbound[0] });
  }

  const results: any[] = [];
  for (const e of outbound) {
    const to = e._resolvedEmail!;
    const subject = `Re: ${e.subject || "Your message"}`;
    const text = e.text
      ? `Hi — thanks for your message!\n\n${e.text}`
      : "Thanks for reaching out.";

    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, text }),
    });

    const ok = res.status === 202 || res.ok;
    console.log(`[webhook] send to=${to} status=${res.status}`);
    results.push({ to, status: res.status, ok });
  }

  return json({ ok: true, sent: results });
}
