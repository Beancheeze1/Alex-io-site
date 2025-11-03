import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HSMsg = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string;
  fromEmail?: string;
  text?: string;
  subject?: string;
  messageId?: string;
  headers?: Record<string, string>;
  message?: { from?: { email?: string }; text?: string; subject?: string };
};

function parseBodyOnce(raw: string): any {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const t = raw.trim();
    try { return JSON.parse(t); } catch { return {}; }
  }
}

function first<T>(...vals: (T | undefined | null)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v as T;
  return undefined;
}

function extract(msg: any) {
  const body: HSMsg = Array.isArray(msg) ? (msg[0] ?? {}) : msg ?? {};
  const toEmail = first(body?.message?.from?.email, body?.fromEmail, (body as any)?.from?.email);
  const text    = first(body?.message?.text, body?.text, (body as any)?.messageText);
  const subject = first(body?.subject, body?.message?.subject, "your message to Alex-IO");
  const messageId = first(
    body?.messageId,
    body?.headers?.["Message-Id"],
    body?.headers?.["message-id"]
  );
  const subtype = { subscriptionType: body?.subscriptionType, messageType: body?.messageType ?? null, changeFlag: body?.changeFlag };
  return { toEmail, text, subject, messageId, subtype };
}

async function callOrchestrate(req: NextRequest, payload: any) {
  const headers = { "Content-Type": "application/json" };

  // 1) relative (best for same origin in Next/Render)
  const tryUrls: string[] = ["/api/ai/orchestrate"];

  // 2) absolute via request origin
  try {
    const abs = new URL("/api/ai/orchestrate", req.url).toString();
    tryUrls.push(abs);
  } catch { /* ignore */ }

  // 3) absolute via NEXT_PUBLIC_BASE_URL (if present)
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    tryUrls.push(`${process.env.NEXT_PUBLIC_BASE_URL.replace(/\/+$/,"")}/api/ai/orchestrate`);
  }

  let lastErr: any = null;
  for (const url of tryUrls) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const status = resp.status;
      let data: any = null;
      try { data = await resp.json(); } catch { data = { nonJson: true }; }
      return { ok: true, url, status, data };
    } catch (e: any) {
      lastErr = e;
      // continue to next url
    }
  }
  return { ok: false, error: "fetch_failed", detail: String(lastErr) };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const isDry = req.nextUrl.searchParams.get("dryRun") === "1";

  const raw = await req.text();                  // READ ONCE
  const msg = parseBodyOnce(raw);
  const { toEmail, text, subject, messageId, subtype } = extract(msg);

  console.log("////////////////////////////////////////////////////////");
  console.log("[webhook] ARRIVE {");
  console.log("  subtype:", JSON.stringify(subtype), ",");
  console.log("}");
  console.log("[webhook] shallow extract ->", JSON.stringify({
    hasEmail: !!toEmail, hasText: !!text, messageId: messageId ?? null
  }));

  if (isDry) {
    return NextResponse.json({ ok: true, dryRun: true, ms: Date.now() - t0 });
  }

  if (!toEmail || !text) {
    console.log("[webhook] IGNORE missing { toEmail:", !!toEmail, ", text:", !!text, "}");
    return NextResponse.json({
      ok: true, ignored: true, reason: "missing toEmail or text", ms: Date.now() - t0
    });
  }

  const payload = {
    mode: "ai",
    toEmail,
    inReplyTo: messageId,
    subject: `Re: ${subject}`,
    text,
    dryRun: false,
  };

  const result = await callOrchestrate(req, payload);
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: "orchestrator_fetch_failed",
      detail: result.detail ?? "fetch failed",
      ms: Date.now() - t0
    });
  }

  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    orchestrate: { url: result.url, status: result.status, data: result.data }
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, method: "GET" });
}
