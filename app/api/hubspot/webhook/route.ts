// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * HubSpot Webhook (App Router)
 * Robust extraction of toEmail/subject/text + fallback fetch; forwards to /api/ai/orchestrate
 */
export const dynamic = "force-dynamic";

type OrchestrateBody = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
};

type HubSpotEvent = {
  subscriptionType?: string;
  eventId?: string;
  objectId?: string | number;
  messageId?: string | number;
  conversationId?: string | number;
  threadId?: string | number;
  occurredAt?: number | string;
  appId?: string | number;
  changeFlag?: string;
  messageType?: string;
  message?: any;
  data?: any;
  from?: { email?: string } | string;
  to?: { email?: string } | Array<{ email?: string }> | string;
  subject?: string;
  text?: string;
  html?: string;
  [k: string]: any;
};

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function boolish(v: any): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }
  return false;
}

function pickFirstEmail(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && value.includes("@")) return value;
  if (Array.isArray(value)) {
    for (const it of value) {
      const e = pickFirstEmail(it);
      if (e) return e;
    }
  } else if (typeof value === "object") {
    for (const key of ["email", "address", "from", "to", "sender"]) {
      const maybe = (value as any)[key];
      const e = pickFirstEmail(maybe);
      if (e) return e;
    }
  }
  return undefined;
}

function coerceString(x: any): string | undefined {
  if (x == null) return undefined;
  return typeof x === "string" ? x : String(x);
}

function trimEmailLike(x?: string): string | undefined {
  if (!x) return undefined;
  const m = x.match(/<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i);
  return m?.[1] ?? x;
}

function extractFlatFields(e: HubSpotEvent) {
  const subject =
    coerceString(e.subject) ??
    coerceString(e?.message?.subject) ??
    coerceString(e?.data?.subject);

  const text =
    coerceString(e.text) ??
    coerceString(e?.message?.text) ??
    coerceString(e?.data?.text) ??
    coerceString(e?.message?.body) ??
    coerceString(e?.data?.body);

  const html =
    coerceString(e.html) ??
    coerceString(e?.message?.html) ??
    coerceString(e?.data?.html);

  let toEmail =
    trimEmailLike(pickFirstEmail(e?.from)) ??
    trimEmailLike(pickFirstEmail(e?.message?.from)) ??
    trimEmailLike(pickFirstEmail(e?.data?.from)) ??
    trimEmailLike(pickFirstEmail(e?.message?.recipient)) ??
    trimEmailLike(pickFirstEmail(e?.data?.recipient)) ??
    trimEmailLike(pickFirstEmail(e?.to));

  const inReplyTo =
    coerceString(e.messageId) ??
    coerceString(e.objectId) ??
    coerceString(e?.message?.id) ??
    coerceString(e?.data?.messageId) ??
    null;

  return { subject, text, html, toEmail, inReplyTo };
}

async function getHubSpotToken(): Promise<string | undefined> {
  try {
    const base = envOrThrow("NEXT_PUBLIC_BASE_URL");
    const r = await fetch(`${base}/api/hubspot/refresh`, { cache: "no-store" });
    if (!r.ok) return undefined;
    const j = await r.json();
    return j?.access_token ?? j?.accessToken ?? j?.token;
  } catch {
    return undefined;
  }
}

async function fetchMessageDetailIfNeeded(
  token: string | undefined,
  e: HubSpotEvent
): Promise<Partial<Pick<OrchestrateBody, "toEmail" | "subject" | "text" | "inReplyTo">>> {
  let { toEmail, subject, text, inReplyTo } = extractFlatFields(e);
  if (toEmail && (text || subject)) return { toEmail, subject, text, inReplyTo };
  if (!token) return {};

  const msgId =
    coerceString(e.messageId) ??
    coerceString(e.objectId) ??
    coerceString(e?.message?.id) ??
    coerceString(e?.data?.messageId);

  if (!msgId) return {};

  try {
    const r = await fetch(
      `https://api.hubapi.com/conversations/v3/conversations/messages/${encodeURIComponent(
        msgId
      )}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (r.ok) {
      const j = await r.json();
      toEmail =
        trimEmailLike(
          pickFirstEmail(j?.from) ??
            pickFirstEmail(j?.sender) ??
            pickFirstEmail(j?.recipient) ??
            pickFirstEmail(j?.participants)
        ) || toEmail;

      subject = coerceString(j?.subject) ?? subject;
      text =
        coerceString(j?.text) ??
        coerceString(j?.body) ??
        coerceString(j?.message?.text) ??
        text;

      inReplyTo = inReplyTo ?? coerceString(j?.id) ?? null;

      return { toEmail, subject, text, inReplyTo };
    }
  } catch {
    // ignore
  }

  return {};
}

function chooseBodyText(text?: string, html?: string): string | undefined {
  if (text && text.trim().length) return text;
  if (!html) return undefined;
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const url = new URL(req.url);

  const dryRunQs = url.searchParams.get("dryRun");
  const dryRunHdr = req.headers.get("x-dryrun");
  const dryRun = boolish(dryRunQs) || boolish(dryRunHdr);

  // ---- FIX: safe/typed JSON parsing without union assignment ----
  let incoming: unknown;
  try {
    incoming = await req.json();
  } catch {
    incoming = {};
  }
  const events: HubSpotEvent[] = Array.isArray(incoming)
    ? (incoming as HubSpotEvent[])
    : [incoming as HubSpotEvent];
  // ---------------------------------------------------------------

  const ev = events[0] ?? ({} as HubSpotEvent);

  let { subject, text, html, toEmail, inReplyTo } = extractFlatFields(ev);

  if (!toEmail || (!text && !html)) {
    const token = await getHubSpotToken();
    const fetched = await fetchMessageDetailIfNeeded(token, ev);
    toEmail = fetched.toEmail ?? toEmail;
    subject = fetched.subject ?? subject;
    text = fetched.text ?? text;
    inReplyTo = fetched.inReplyTo ?? inReplyTo ?? null;
  }

  const body: OrchestrateBody = {
    mode: "ai",
    toEmail: (toEmail ?? "").trim(),
    subject: subject?.trim(),
    text: chooseBodyText(text, html),
    inReplyTo: inReplyTo ?? null,
    dryRun,
  };

  console.log("[webhook] received {");
  console.log(" subType:", ev?.subscriptionType ?? "unknown");
  console.log(" toEmail:", body.toEmail || "undefined");
  console.log(" hasText:", !!body.text);
  console.log(" hasHtml:", !!html);
  console.log(" inReplyTo:", body.inReplyTo);
  console.log(" dryRunChosen:", body.dryRun === true);
  console.log("}");

  if (!body.toEmail) {
    console.warn("[webhook] missing toEmail; skipping orchestrate");
    return NextResponse.json(
      { ok: true, reason: "missing_toEmail" },
      { status: 200 }
    );
  }

  const replyEnabled = (process.env.REPLY_ENABLED ?? "true").toLowerCase() === "true";
  if (!replyEnabled && !dryRun) {
    console.log(
      "[webhook] REPLY_ENABLED=false; forcing dryRun orchestrate for safety"
    );
    body.dryRun = true;
  }

  try {
    const base = envOrThrow("NEXT_PUBLIC_BASE_URL");
    const r = await fetch(`${base}/api/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });

    const jr = await r.json().catch(() => ({}));
    console.log("[webhook] orchestrate result {");
    console.log(" status:", r.status);
    console.log(" ok:", r.ok);
    console.log(" send_status:", jr?.status ?? "n/a");
    console.log(" send_ok:", jr?.ok ?? "n/a");
    console.log(" send_result:", jr?.result ?? "n/a");
    console.log("}");

    return NextResponse.json(
      { ok: true, elapsed_ms: Date.now() - started, orchestrate: jr },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[webhook] orchestrate error:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "orchestrate_failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "hubspot/webhook" }, { status: 200 });
}
