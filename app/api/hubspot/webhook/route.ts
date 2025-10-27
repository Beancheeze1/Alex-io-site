// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type HubSpotEvent = {
  subscriptionType?: string;         // "conversation.newMessage"
  changeFlag?: string;               // "NEW_MESSAGE"
  messageType?: string;              // "MESSAGE"
  objectId?: number;                 // threadId
  customerEmail?: string;            // sometimes missing
  fromEmail?: string;                // sometimes present
  subject?: string;
  text?: string;
  html?: string;
};

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

// --- helpers ----------------------------------------------------------------

async function getHubspotAccessToken(): Promise<string> {
  // Use our existing internal refresh endpoint
  const base = process.env.NEXT_PUBLIC_BASE_URL!;
  const r = await fetch(`${base}/api/hubspot/refresh`, { cache: "no-store" });
  if (!r.ok) throw new Error(`hs_token_${r.status}`);
  const data = await r.json();
  const tok = data?.access_token || data?.accessToken || data?.token;
  if (!tok) throw new Error("hs_token_missing");
  return tok;
}

// Fetch latest INBOUND message on a thread and try to extract the sender email
async function resolveEmailFromThread(threadId: number): Promise<string | null> {
  const token = await getHubspotAccessToken();
  // Grab most recent messages; API defaults work, but we’ll be explicit
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages?limit=10&sort=createdAt&order=DESC`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.log(`[webhook] thread fetch ${threadId} error ${r.status} ${t}`);
    return null;
  }
  const data = await r.json().catch(() => ({}));
  const msgs: any[] = data?.results || data?.messages || [];
  // Find the newest inbound, then extract an address from common shapes
  const inbound = msgs.find(
    (m) =>
      (m?.direction || m?.messageDirection || "").toUpperCase() === "INBOUND" ||
      (m?.type || "").toUpperCase() === "INBOUND"
  ) || msgs[0];

  if (!inbound) return null;

  // Try a few field shapes HubSpot uses
  const candidates: string[] = [
    inbound?.from?.email,
    inbound?.sender?.email,
    inbound?.sender?.address,
    inbound?.channel?.from?.email,
    inbound?.recipient?.email, // just in case
  ].filter(Boolean);

  const email = (candidates[0] || "").toString().trim().toLowerCase();
  return email || null;
}

function looksLikeInbound(e: HubSpotEvent) {
  return (
    (e.subscriptionType || "").toLowerCase() === "conversation.newmessage" &&
    (e.changeFlag || "").toUpperCase() === "NEW_MESSAGE" &&
    (e.messageType || "MESSAGE").toUpperCase() === "MESSAGE"
  );
}

// --- route -------------------------------------------------------------------

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

  if (!events.length) {
    return json({ ok: true, skipped: true, reason: "no_events" });
  }

  // Only consider proper "new message" events
  const candidates = events.filter(looksLikeInbound);
  if (!candidates.length) {
    console.log("[webhook] no_valid_inbound (shape)");
    return json({ ok: true, skipped: true, reason: "no_valid_inbound" });
  }

  // Resolve an email for each candidate (directly or via thread lookup)
  const resolved = await Promise.all(
    candidates.map(async (e) => {
      let email =
        e.customerEmail?.toLowerCase() ||
        e.fromEmail?.toLowerCase() ||
        null;

      if (!email && e.objectId) {
        email = (await resolveEmailFromThread(e.objectId)) || null;
      }

      return {
        ...e,
        _resolvedEmail: email,
      };
    })
  );

  // Filter out self loops and missing emails
  const self = "sales@alex-io.com";
  const outbound = resolved.filter(
    (e) => e._resolvedEmail && !e._resolvedEmail!.includes(self)
  );

  if (!outbound.length) {
    console.log("[webhook] no_valid_inbound (missing/loop email)");
    return json({
      ok: true,
      skipped: true,
      reason: "no_valid_inbound",
      note: "no customer email found on events",
    });
  }

  if (dryRun) {
    console.log("[webhook] DRYRUN to=" + outbound[0]._resolvedEmail);
    return json({ ok: true, dryRun: true, sample: outbound[0] });
  }

  // Send replies via our Graph endpoint
  const results: any[] = [];
  for (const e of outbound) {
    const to = e._resolvedEmail!;
    const subject = `Re: ${e.subject || "Your message"}`;
    const text = e.text
      ? `Hi — thanks for your message!\n\n${e.text}`
      : "Thanks for reaching out.";

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/ms/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, text }),
      }
    );

    const ok = res.status === 202 || res.ok;
    console.log(`[webhook] send to=${to} status=${res.status}`);
    results.push({ to, status: res.status, ok });
  }

  return json({ ok: true, sent: results });
}
