// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot Webhook (conversation.newMessage)
 * - Accepts array or object payloads (HubSpot test vs live)
 * - Extracts { toEmail, text, subject, messageId }
 * - If anything required is missing -> log and 200 (HubSpot stays green)
 * - ?dryRun=1 echoes a stub result
 * - Otherwise forwards to /api/ai/orchestrate to send a real reply
 */

type HSSubtype = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string;
};

function toArray<T = unknown>(x: T | T[] | undefined | null): T[] {
  return Array.isArray(x) ? x : x ? [x] : [];
}

function safeStr(x: unknown): string | undefined {
  if (typeof x === "string") return x;
  if (x == null) return undefined;
  try {
    return String(x);
  } catch {
    return undefined;
  }
}

function findHeader(obj: any, name: string): string | undefined {
  if (!obj) return undefined;
  // common places headers may live
  const fromTop = obj?.headers?.[name];
  if (fromTop) return safeStr(fromTop);

  const msg = obj?.message;
  const fromMsg = msg?.headers?.[name];
  if (fromMsg) return safeStr(fromMsg);

  // some payloads flatten these
  const flat = obj?.[name] ?? msg?.[name];
  return safeStr(flat);
}

function parseHubspotPayload(raw: any) {
  // HubSpot can send an array of events; we handle both forms.
  const payload = Array.isArray(raw) ? raw[0] ?? {} : raw ?? {};

  const subtype: HSSubtype = {
    subscriptionType: payload?.subscriptionType,
    messageType: payload?.messageType ?? payload?.message?.type ?? null,
    changeFlag: payload?.changeFlag,
  };

  const msg = payload?.message ?? {};

  // Try to get the sender email from multiple likely spots:
  const fromEmail =
    safeStr(msg?.from?.email) ??
    safeStr(msg?.fromEmail) ??
    safeStr(msg?.sender?.email) ??
    safeStr(payload?.from?.email);

  // Subject & text are likewise in different places depending on source.
  const subject =
    safeStr(msg?.subject) ??
    safeStr(payload?.subject) ??
    undefined;

  const text =
    safeStr(msg?.text) ??
    safeStr(msg?.text?.plain) ??
    safeStr(payload?.text) ??
    undefined;

  // Message-Id is important for threading / loop-protection.
  const messageId =
    findHeader(payload, "Message-Id") ??
    safeStr(payload?.messageId) ??
    safeStr(msg?.messageId) ??
    undefined;

  const hasEmail = !!fromEmail;
  const hasText = !!text || !!subject;

  return {
    subtype,
    fromEmail,
    subject,
    text,
    messageId,
    hasEmail,
    hasText,
    debug: { subtype, peek: { subject, text, messageId } },
  };
}

function getBaseUrl() {
  // Prefer explicit base if set; otherwise fall back to production domain.
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://api.alex-io.com"
  );
}

export async function GET() {
  // We do not serve GET here (keeps your test chain honest)
  return new NextResponse("Method Not Allowed", { status: 405 });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // keep body as {}
  }

  const parsed = parseHubspotPayload(body);

  // Always log an ARRIVE line so you can see if HubSpot is hitting you.
  console.log("[webhook] ARRIVE", {
    subtype: parsed.subtype,
    hasEmail: parsed.hasEmail,
    hasText: parsed.hasText,
  });

  if (!parsed.hasEmail || !parsed.hasText) {
    console.log("[webhook] IGNORE missing", {
      toEmail: parsed.hasEmail,
      text: parsed.hasText,
    });
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "missing toEmail or text",
      subtype: parsed.subtype,
    });
  }

  if (dryRun) {
    // Echo a stubbed result for your PowerShell `?dryRun=1` sanity checks.
    return NextResponse.json({
      ok: true,
      dryRun: true,
      toEmail: parsed.fromEmail,
      subject: parsed.subject ?? "(no subject)",
      textPreview: (parsed.text ?? "").slice(0, 120),
      graph: { status: 200, dryRun: true },
    });
  }

  // Forward to the AI orchestrator to craft the real “AI-like” reply and send.
  const orchestrateUrl = `${getBaseUrl()}/api/ai/orchestrate`;

  const payload = {
    mode: "reply", // lets orchestrator know this is an inbound reply flow
    toEmail: parsed.fromEmail,
    subject: parsed.subject ?? "",
    text: parsed.text ?? "",
    inReplyTo: parsed.messageId ?? null,
    // keep a trimmed debug block for Render logs
    debug: parsed.debug,
  };

  let status = 0;
  let sent = false;
  let detail: string | undefined;

  try {
    const res = await fetch(orchestrateUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      // no-cache to avoid Next.js caching any internal calls
      cache: "no-store",
    });
    status = res.status;
    sent = res.ok;
    if (!res.ok) {
      detail = await res.text().catch(() => undefined);
    }
  } catch (err: any) {
    detail = err?.message ?? "fetch failed";
  }

  if (!sent) {
    console.log("[webhook] ERROR orchestrator", { status, detail });
    // Still 200 to HubSpot so it won’t retry-spam you,
    // but include the failure details for your logs.
    return NextResponse.json({
      ok: false,
      error: "orchestrator_failed",
      status,
      detail,
    });
  }

  console.log("[webhook] SENT via orchestrator", {
    to: payload.toEmail,
    status,
  });

  return NextResponse.json({
    ok: true,
    toEmail: payload.toEmail,
    status,
  });
}
