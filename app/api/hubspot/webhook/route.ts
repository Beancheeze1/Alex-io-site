// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot conversation.newMessage webhook
 * - Reads request body EXACTLY ONCE (req.text()) to avoid "Body is unusable"
 * - Accepts array or object payloads
 * - Extracts { toEmail, text, messageId, subject }
 * - ?dryRun=1 => stub 200 with ok:true (no orchestration)
 * - Otherwise forwards to /api/ai/orchestrate
 */

type HSMsg = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string;
  fromEmail?: string;                 // optional root alias
  text?: string;                      // optional root alias
  subject?: string;
  messageId?: string;
  headers?: Record<string, string>;
  message?: {
    from?: { email?: string };
    text?: string;
    subject?: string;
  };
};

function parseBodyOnce(raw: string): any {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Sometimes HubSpot tooling posts newline/prefix junk; try to salvage
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
}

function first<T>(...vals: (T | undefined | null)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v as T;
  return undefined;
}

function extract(msg: any) {
  // Handle array or object
  const body: HSMsg = Array.isArray(msg) ? (msg[0] ?? {}) : msg ?? {};

  const toEmail = first(
    body?.message?.from?.email,
    body?.fromEmail,
    (body as any)?.from?.email
  );

  const text = first(
    body?.message?.text,
    body?.text,
    (body as any)?.messageText
  );

  const subject = first(
    body?.subject,
    body?.message?.subject,
    "your message to Alex-IO"
  );

  const messageId = first(
    body?.messageId,
    body?.headers?.["Message-Id"],
    body?.headers?.["message-id"]
  );

  const subtype = {
    subscriptionType: body?.subscriptionType,
    messageType: body?.messageType ?? null,
    changeFlag: body?.changeFlag,
  };

  return { toEmail, text, subject, messageId, subtype };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const isDry = req.nextUrl.searchParams.get("dryRun") === "1";

  // READ BODY ONCE to avoid "Body is unusable"
  const raw = await req.text();
  const msg = parseBodyOnce(raw);
  const { toEmail, text, subject, messageId, subtype } = extract(msg);

  // Simple log lines (keep them compact)
  console.log("////////////////////////////////////////////////////////");
  console.log("[webhook] ARRIVE {");
  console.log("  subtype:", JSON.stringify(subtype), ",");
  console.log("}");
  console.log("[webhook] shallow extract ->", JSON.stringify({
    hasEmail: !!toEmail,
    hasText: !!text,
    messageId: messageId ?? null
  }));

  if (isDry) {
    // Never forward on dry runs
    return NextResponse.json({
      ok: true,
      dryRun: true,
      ms: Date.now() - t0
    });
  }

  if (!toEmail || !text) {
    console.log("[webhook] IGNORE missing { toEmail:", !!toEmail, ", text:", !!text, "}");
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "missing toEmail or text",
      ms: Date.now() - t0
    });
  }

  // Forward to AI orchestrator
  const payload = {
    mode: "ai",
    toEmail,
    inReplyTo: messageId,
    subject: `Re: ${subject}`,
    text,
    dryRun: false
  };

  const origin = new URL(req.url);
  const orchestrateUrl = new URL("/api/ai/orchestrate", origin.origin).toString();

  let data: any = null;
  let status = 0;
  try {
    const resp = await fetch(orchestrateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    status = resp.status;
    // guard in case non-JSON
    try { data = await resp.json(); } catch { data = { nonJson: true }; }
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: "orchestrator_fetch_failed",
      detail: String(e?.message ?? e),
      ms: Date.now() - t0
    });
  }

  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    orchestrate: { status, data }
  });
}

// Optional: small GET for quick sanity
export async function GET() {
  return NextResponse.json({ ok: true, method: "GET" });
}
