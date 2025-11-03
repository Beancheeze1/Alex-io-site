// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HSMsg = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string | null;
  message?: {
    from?: { email?: string };
    id?: string; // HubSpot messageId
  };
  objectId?: number | string; // sometimes present
};

type Extracted = {
  toEmail?: string;
  text?: string;
  subject?: string;
  messageId?: string;
};

function log(...args: any[]) {
  // small guard to keep logs tidy on Render
  console.log("[webhook]", ...args);
}

function shallowExtract(anyBody: any): Extracted {
  // Accept both array-of-events and object payloads
  const body = Array.isArray(anyBody) ? anyBody[0] : anyBody;
  const out: Extracted = {};

  try {
    const m: HSMsg | undefined = body?.message ? body : undefined;

    // Known HubSpot webhook shape (when present)
    const fromEmail =
      body?.message?.from?.email ??
      body?.from?.email ??
      body?.sender?.email ??
      undefined;

    // Some “test” payloads use a ‘text’ field directly
    const text =
      body?.text ??
      body?.message?.text ??
      body?.message?.body ??
      body?.message?.content ??
      undefined;

    const subject =
      body?.subject ??
      body?.message?.subject ??
      undefined;

    const messageId =
      body?.messageId ??
      body?.message?.id ??
      body?.id ??
      undefined;

    if (fromEmail) out.toEmail = String(fromEmail).trim();
    if (text) out.text = String(text).trim();
    if (subject) out.subject = String(subject).trim();
    if (messageId) out.messageId = String(messageId).trim();
  } catch {
    // no-op; we log outside
  }
  return out;
}

async function safeJson(res: Response): Promise<any | null> {
  // Never throw on non-JSON/empty body — log and return null
  let text = "";
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e: any) {
    const preview = text.length > 160 ? text.slice(0, 160) + "…" : text;
    log("lookup_error:", "status", res.status, "| body-preview:", preview);
    return null;
  }
}

async function deepLookup(baseUrl: string, messageId: string): Promise<Extracted> {
  const url = `${baseUrl}/api/hubspot/lookup?messageId=${encodeURIComponent(messageId)}&mode=deep`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "accept": "application/json" },
    // Avoid caching in edge/CDN
    cache: "no-store",
  });

  // Try to parse JSON but never throw
  const data = await safeJson(res);
  const out: Extracted = {};
  if (data?.toEmail) out.toEmail = String(data.toEmail).trim();
  if (data?.text) out.text = String(data.text).trim();
  if (data?.subject) out.subject = String(data.subject).trim();
  return out;
}

async function sendViaOrchestrate(baseUrl: string, payload: {
  toEmail: string;
  text: string;
  subject?: string;
  dryRun?: boolean;
}) {
  const url = `${baseUrl}/api/ai/orchestrate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      mode: "live",
      toEmail: payload.toEmail,
      subject: payload.subject ?? "(no subject)",
      text: payload.text,
    }),
  });
  const json = await safeJson(res);
  return { status: res.status, json };
}

function pickBaseUrl(req: NextRequest) {
  // Honor NEXT_PUBLIC_BASE_URL if set; otherwise reconstruct from request
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const origin = req.nextUrl.origin.replace(/\/+$/, "");
  return origin;
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null; // ok, some tests may send empty
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const subtype =
    Array.isArray(body) ? body[0]?.subscriptionType : body?.subscriptionType;

  log("ARRIVE {");
  log("  subtype:", JSON.stringify({
    subscriptionType: subtype ?? "undefined",
    messageType: (Array.isArray(body) ? body[0]?.messageType : body?.messageType) ?? null,
    changeFlag: (Array.isArray(body) ? body[0]?.changeFlag : body?.changeFlag) ?? "undefined",
  }));
  log("}");

  // 1) Shallow attempt
  const shallow = shallowExtract(body);
  log("shallow extract ->", JSON.stringify({
    hasEmail: !!shallow.toEmail,
    hasText: !!shallow.text,
    messageId: shallow.messageId ?? undefined,
  }));

  // 2) If missing essentials, try deep lookup by messageId
  let final: Extracted = { ...shallow };
  if ((!final.toEmail || !final.text) && final.messageId) {
    try {
      const base = pickBaseUrl(req);
      const deep = await deepLookup(base, final.messageId);
      final = { ...final, ...deep };
    } catch (e: any) {
      log("lookup_error:", e?.message ?? String(e));
    }
  }

  // 3) If still missing, keep HS green but don’t send
  if (!final.toEmail || !final.text) {
    log("IGNORE missing { toEmail:", !!final.toEmail, ", text:", !!final.text, "}");
    return NextResponse.json({ ok: true, ignored: true });
  }

  // 4) Dry-run echo (helps CLI testing)
  if (dryRun) {
    log("dryRun -> would orchestrate to", final.toEmail);
    return NextResponse.json({
      ok: true,
      dryRun: true,
      toEmail: final.toEmail,
      subject: final.subject ?? "(no subject)",
      text: final.text.slice(0, 140),
    });
  }

  // 5) Real send via orchestrator
  const base = pickBaseUrl(req);
  const { status, json } = await sendViaOrchestrate(base, {
    toEmail: final.toEmail!,
    subject: final.subject,
    text: final.text!,
  });

  log("orchestrate ->", status, json ?? null);
  return NextResponse.json({ ok: status >= 200 && status < 300 });
}

export async function GET() {
  // Simple health for your 405/200 checks
  return NextResponse.json({ ok: true, method: "GET" });
}
