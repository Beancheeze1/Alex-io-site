// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot Webhook (conversation.newMessage)
 * Path A: extract {toEmail, text, subject?, messageId} and forward to /api/ai/orchestrate
 * - Accepts array or object payloads
 * - Returns 200 to keep HubSpot green
 */

type HSMsg = {
  subscriptionType?: string;
  messageType?: string;
  changeFlag?: string;
  message?: {
    from?: { email?: string };
    text?: string;            // common
    textHtml?: string;        // sometimes present
    content?: string;         // alt
    body?: string;            // alt
    subject?: string;         // alt
  };
  headers?: Record<string, string>;
  // allow unknown props
  [k: string]: any;
};

function pickFirst(body: any): HSMsg | null {
  if (!body) return null;
  return Array.isArray(body) ? (body[0] as HSMsg) ?? null : (body as HSMsg);
}

function header(h: Record<string, string> | undefined, key: string) {
  if (!h) return undefined;
  const k = Object.keys(h).find((x) => x.toLowerCase() === key.toLowerCase());
  return k ? h[k] : undefined;
}

function extractEmail(ev: HSMsg | null): string | undefined {
  return ev?.message?.from?.email ?? (ev as any)?.fromEmail ?? undefined;
}

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractText(ev: HSMsg | null): string | undefined {
  if (!ev) return undefined;
  const m = ev.message ?? (ev as any);
  const raw =
    m?.text ??
    m?.content ??
    m?.body ??
    (typeof m?.textHtml === "string" ? stripHtml(m.textHtml) : undefined) ??
    (typeof (ev as any)?.text === "string" ? (ev as any).text : undefined) ??
    undefined;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function extractSubject(ev: HSMsg | null): string | undefined {
  const m = ev?.message ?? (ev as any);
  const s = m?.subject ?? (ev as any)?.subject;
  return typeof s === "string" && s.trim() ? s.trim() : undefined;
}

function extractMessageId(ev: HSMsg | null): string | undefined {
  const h = ev?.headers;
  return (
    header(h, "Message-Id") ||
    header(h, "Message-ID") ||
    header(h, "message-id") ||
    (ev as any)?.messageId ||
    undefined
  );
}

async function postJson(url: string, payload: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  // try to parse, but keep raw text for logging
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

export async function GET() {
  // We intentionally allow GET=405 in prior versions, but returning 200 here keeps CF/health probes happy.
  return NextResponse.json({ ok: true, method: "GET" }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    console.log("[webhook] ERROR invalid_json");
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 200 });
  }

  const ev = pickFirst(body);
  const toEmail = extractEmail(ev);
  const text = extractText(ev);
  const subject = extractSubject(ev);
  const messageId = extractMessageId(ev);

  console.log("[webhook] ARRIVE", {
    subtype: {
      subscriptionType: ev?.subscriptionType ?? "",
      messageType: ev?.messageType ?? "",
      changeFlag: ev?.changeFlag ?? "",
    },
    hasEmail: !!toEmail,
    hasText: !!text,
  });

  // keep HubSpot green but explain why ignored
  if (!toEmail || !text) {
    console.log("[webhook] IGNORE missing", { toEmail: !!toEmail, text: !!text });
    return NextResponse.json(
      { ok: true, ignored: true, reason: !toEmail ? "no_email" : "no_text" },
      { status: 200 }
    );
  }

  // Call the AI orchestrator (this is what gives you the “AI-like” responses)
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    "https://api.alex-io.com";

  const orchUrl = `${base}/api/ai/orchestrate${dryRun ? "?dryRun=1" : ""}`;

  const payload = {
    toEmail,
    text,
    subject,
    messageId,
    // let orchestrate decide: estimate vs clarify vs reply
    mode: "reply",
  };

  const r = await postJson(orchUrl, payload);

  if (!r.ok) {
    console.log("[webhook] ERROR orchestrate_failed", { status: r.status, body: r.text?.slice(0, 400) });
    // still 200 so HS won’t retry; we’ll see it in our logs
    return NextResponse.json(
      { ok: false, error: "orchestrate_failed", status: r.status },
      { status: 200 }
    );
  }

  console.log("[webhook] FORWARDED to orchestrate", { status: r.status });
  return NextResponse.json(
    { ok: true, forwarded: true, orchestrate: { status: r.status, dryRun } },
    { status: 200 }
  );
}
