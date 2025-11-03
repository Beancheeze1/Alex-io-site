// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callMsGraphSend } from "@/app/lib/msgraph";
import { parseHubspotPayload } from "@/app/lib/hubspot";
import { makeKv } from "@/app/lib/kv";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot Webhook (conversation.newMessage)
 * - Accepts object or array payloads (HubSpot UI test vs live)
 * - Extracts { toEmail, text, subject, messageId }
 * - ?dryRun=1 -> returns stub result and 200 (no external send)
 * - Otherwise forwards to /api/ai/orchestrate to generate/send a reply
 * - Always returns 200 to keep HubSpot dashboard green
 */

type HSArr = any[];
type HSObj = Record<string, any>;
type MaybeHS = HSArr | HSObj | undefined | null;

function pick<T>(v: T | undefined | null, def: T): T {
  return v === undefined || v === null ? def : v;
}

function coerceJson(x: unknown): MaybeHS {
  if (typeof x === "string") {
    try { return JSON.parse(x); } catch { return undefined; }
  }
  if (x && typeof x === "object") return x as any;
  return undefined;
}

/**
 * Attempt to pull an email address from common HubSpot shapes.
 */
function extractFromEmail(anyMsg: any): string | undefined {
  // Common live shape: message.from.email
  const viaFrom = anyMsg?.message?.from?.email;
  if (typeof viaFrom === "string" && viaFrom.includes("@")) return viaFrom.trim();

  // Some UI tests: message?.origin?.email OR properties?
  const viaOrigin = anyMsg?.message?.origin?.email;
  if (typeof viaOrigin === "string" && viaOrigin.includes("@")) return viaOrigin.trim();

  const viaProps = anyMsg?.message?.fromEmail ?? anyMsg?.fromEmail ?? anyMsg?.email;
  if (typeof viaProps === "string" && viaProps.includes("@")) return viaProps.trim();

  // Sometimes in headers
  const hdrs = anyMsg?.headers ?? anyMsg?.message?.headers;
  const hdrEmail = hdrs?.["From"] ?? hdrs?.["from"] ?? hdrs?.["sender"];
  if (typeof hdrEmail === "string" && hdrEmail.includes("@")) return hdrEmail.trim();

  return undefined;
}

/**
 * Pull plain text content (fallbacks included).
 */
function extractText(anyMsg: any): string | undefined {
  // Live payloads often carry message.text
  if (typeof anyMsg?.message?.text === "string" && anyMsg.message.text.trim()) {
    return anyMsg.message.text.trim();
  }
  // Some carry body or html stripped
  if (typeof anyMsg?.message?.body === "string" && anyMsg.message.body.trim()) {
    return anyMsg.message.body.trim();
  }
  if (typeof anyMsg?.text === "string" && anyMsg.text.trim()) {
    return anyMsg.text.trim();
  }
  if (typeof anyMsg?.body === "string" && anyMsg.body.trim()) {
    return anyMsg.body.trim();
  }
  return undefined;
}

/**
 * Subject + messageId best-effort.
 */
function extractSubject(anyMsg: any): string | undefined {
  return (
    anyMsg?.message?.subject ??
    anyMsg?.subject ??
    anyMsg?.headers?.subject ??
    anyMsg?.headers?.Subject
  );
}
function extractMsgId(anyMsg: any): string | undefined {
  return (
    anyMsg?.messageId ??
    anyMsg?.message?.messageId ??
    anyMsg?.headers?.["Message-Id"] ??
    anyMsg?.headers?.["message-id"] ??
    anyMsg?.headers?.["MessageId"]
  );
}

/**
 * Normalize HubSpot payload (object or array). Return the "latest" message-like item.
 */
function normalizeFirstItem(payload: MaybeHS): any | undefined {
  if (!payload) return undefined;
  if (Array.isArray(payload)) {
    // HubSpot UI test sends an array; pick last/newest non-null object
    for (let i = payload.length - 1; i >= 0; i--) {
      const x = payload[i];
      if (x && typeof x === "object") return x;
    }
    return undefined;
  }
  // Single object case
  return payload;
}

export async function GET() {
  // For sanity: GET should yield 405, so callers know to POST
  return NextResponse.json({ ok: true, method: "GET" });
}

export async function POST(req: NextRequest) {
  const u = new URL(req.url);
  const dryRun = u.searchParams.get("dryRun") === "1";

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }

  const payload = coerceJson(raw);
  const item = normalizeFirstItem(payload);

  // Shallow subtype info for log
  const subtype = {
    subscriptionType: item?.subscriptionType ?? item?.eventType ?? undefined,
    messageType: item?.messageType ?? null,
    changeFlag: item?.changeFlag ?? undefined,
  };

  // Extract essentials
  const toEmail = extractFromEmail(item);
  const text = extractText(item);
  const subject = pick(extractSubject(item), "(no subject)");
  const messageId = extractMsgId(item);

  const hasEmail = Boolean(toEmail);
  const hasText = Boolean(text);

  // Console logs show up in Render logs
  console.log("[webhook] ARRIVE {");
  console.log("  subtype:", JSON.stringify(subtype));
  console.log("  hasEmail:", hasEmail, ", hasText:", hasText);
  console.log("}");

  if (!hasEmail || !hasText) {
    console.log("[webhook] IGNORE missing { toEmail:", hasEmail, ", text:", hasText, "}");
    return NextResponse.json({ ok: true, ignored: true, reason: "missing_toEmail_or_text" });
  }

  if (dryRun) {
    // Don’t send — just echo what we would use.
    return NextResponse.json({
      ok: true,
      dryRun: true,
      toEmail,
      subject,
      text,
      messageId,
      note: "Would forward to /api/ai/orchestrate",
    });
  }

  // Forward to your AI orchestrator (internal call)
  let orchStatus = 0;
  let orchJson: any = null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ai/orchestrate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ toEmail, text, subject, messageId }),
});
    orchStatus = res.status;
    try { orchJson = await res.json(); } catch { orchJson = { note: "non-json response" }; }
  } catch (e: any) {
    console.error("[webhook] orchestrate call failed:", e?.message ?? e);
    orchStatus = 500;
    orchJson = { ok: false, error: "orchestrate_fetch_failed" };
  }

  return NextResponse.json({
    ok: true,
    forwarded: true,
    orchestrate: { status: orchStatus, body: orchJson },
  });
}
