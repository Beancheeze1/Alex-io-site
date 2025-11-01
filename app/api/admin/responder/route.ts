// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";

// If you moved the helper into /lib/msgraph.ts use this:
import { sendGraphMail } from "@/lib/msgraph";
// If you kept it at repo root use:  import { sendGraphMail } from "@/msgraph";

export const dynamic = "force-dynamic";

function b(v: string | undefined, def = false) {
  return v ? /^(1|true|yes|on)$/i.test(v) : def;
}
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

type Envelope = {
  subType?: string;
  objId?: string | number;
  channel?: string;
  direction?: string;
};

async function getHubSpotToken(): Promise<string> {
  // Uses your existing refresh endpoint that returns a JSON
  // with { ok:true, access_token:"..." }.
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const r = await fetch(`${base}/api/hubspot/refresh`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.access_token) {
    throw new Error(`HubSpot refresh failed (${r.status})`);
  }
  return j.access_token as string;
}

/**
 * Fetch the latest inbound message on the HubSpot conversation thread
 * and return { fromEmail, subject }. Falls back to undefined on errors.
 *
 * NOTE: HubSpot conversations APIs vary by account.
 * This uses a conservative "threads/{id}/messages" path that is commonly available.
 */
async function getLatestInboundFromHubSpot(objId: string): Promise<{ fromEmail?: string; subject?: string } | null> {
  try {
    const token = await getHubSpotToken();

    // Try messages list for the thread
    const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(
      objId
    )}/messages?limit=20`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.log("[responder] hubspot thread fetch error", { status: r.status, body: t?.slice(0, 400) });
      return null;
    }

    const data = await r.json().catch(() => ({}));
    const items: any[] = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];

    // Heuristic: pick the most recent INBOUND email not sent by our mailbox
    const self = (process.env.MS_MAILBOX_FROM || "sales@alex-io.com").toLowerCase();
    let bestFrom: string | undefined;
    let bestSubject: string | undefined;

    for (const m of items) {
      const direction = String(m?.direction || m?.messageDirection || "").toUpperCase();
      const ch = String(m?.channel || "").toUpperCase();
      const from = String(
        m?.from?.email ||
          m?.sender?.email ||
          m?.senderEmail ||
          m?.recipient?.email ||
          m?.metadata?.from?.email ||
          ""
      ).toLowerCase();

      const subj = String(
        m?.subject ||
          m?.properties?.subject ||
          m?.metadata?.subject ||
          ""
      );

      if (direction === "INCOMING" || direction === "INBOUND" || (direction === "" && ch === "EMAIL")) {
        if (from && from !== self) {
          bestFrom = from;
          bestSubject = subj || bestSubject;
          break;
        }
      }
    }

    if (!bestFrom) {
      console.log("[responder] hubspot lookup: no inbound sender found");
      return null;
    }
    return { fromEmail: bestFrom, subject: bestSubject };
  } catch (e: any) {
    console.log("[responder] hubspot lookup exception", String(e?.message || e));
    return null;
  }
}

function defaultTemplate(nameOrEmail: string) {
  return `
  <p>Hi ${nameOrEmail},</p>
  <p>Thanks for reaching out — we received your request. I’m preparing a quick quote and will follow up shortly.</p>
  <p>— Alex-IO Bot</p>
  <hr />
  <p style="font-size:12px;color:#666">This message was sent automatically by Alex-IO.</p>
  `;
}

export async function POST(req: Request) {
  const replyEnabled = b(process.env.REPLY_ENABLED, false);
  const from = requireEnv("MS_MAILBOX_FROM");

  // Body can be: { to?, subject?, html?, text?, envelope?, objId? }
  let body: any = {};
  try { body = await req.json(); } catch {}

  const explicitTo = body?.to; // allow manual override
  const explicitSubject = body?.subject;
  const objId = String(body?.objId ?? body?.envelope?.objId ?? "");

  // Safety: if replies disabled, noop but 200 (so HubSpot won’t retry)
  if (!replyEnabled) {
    console.log("[responder] reply disabled — noop");
    return NextResponse.json({ ok: true, sent: false, reason: "reply_disabled" });
  }

  // If caller provided "to", we trust it (used in manual tests)
  if (explicitTo) {
    const toList = Array.isArray(explicitTo) ? explicitTo : [explicitTo];
    const html = body?.html || defaultTemplate(String(toList[0]));
    const subject = explicitSubject || "[Alex-IO] Thanks — we’re on it";
    const r = await sendGraphMail({ to: toList[0], subject, html }); // helper saves to Sent Items
    return NextResponse.json({ ok: r.ok, sent: r.ok, graphStatus: r.status, requestId: r.requestId ?? null });
  }

  // Otherwise, resolve the customer from HubSpot using objId
  if (!objId) {
    console.log("[responder] missing objId and no explicit 'to' — noop");
    return NextResponse.json({ ok: true, sent: false, reason: "missing_objId" });
  }

  const resolved = await getLatestInboundFromHubSpot(objId);
  if (!resolved?.fromEmail) {
    console.log("[responder] could not resolve customer email — noop");
    return NextResponse.json({ ok: true, sent: false, reason: "no_customer_email" });
  }

  const subject = explicitSubject || resolved.subject || "[Alex-IO] Thanks — we’re on it";
  const html = defaultTemplate(resolved.fromEmail);

  // Send the real reply
  try {
    const r = await sendGraphMail({ to: resolved.fromEmail, subject, html }); // Sent Items copy saved
    console.log("[responder] graph result", { status: r.status, requestId: r.requestId });
    return NextResponse.json({ ok: r.ok, sent: r.ok, graphStatus: r.status, requestId: r.requestId ?? null });
  } catch (e: any) {
    console.log("[responder] graph exception", String(e?.message || e));
    return NextResponse.json({ ok: false, sent: false, error: String(e?.message || e) }, { status: 200 });
  }
}

// Optional GET smoke test so you can do quick header/parse passes
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  if (!to) return NextResponse.json({ ok: false, error: "add ?to=email" }, { status: 400 });
  const r = await sendGraphMail({
    to,
    subject: "[Alex-IO] Responder GET smoke",
    html: `<p>Responder GET smoke — ${new Date().toISOString()}</p>`,
  });
  return NextResponse.json({ ok: r.ok, graphStatus: r.status, requestId: r.requestId ?? null });
}
