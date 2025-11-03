// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot Webhook (conversation.newMessage)
 * - Accepts array or object payloads
 * - Extracts { messageId, objectId, subject } shallow
 * - Deep-lookup -> { toEmail, text } via our local /api/hubspot/lookup
 * - On success -> POST to /api/ai/orchestrate with mode: "ai"
 * - Always returns 200 (HubSpot stays green)
 * - ?dryRun=1 echoes what would happen without sending
 */

type HSArrive = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string | null;
  objectId?: string | number;
  message?: { id?: string };
  subject?: string;
};

function getBaseUrl(req: NextRequest) {
  // Prefer explicit base if you’ve set it (you said NEXT_PUBLIC_BASE_URL is set).
  const envBase = process.env.NEXT_PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");

  // Fallback to Host header
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host && host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function readJson(req: NextRequest): Promise<any> {
  // HubSpot may send array or object; Next handles JSON fine.
  try {
    return await req.json();
  } catch {
    // Try text → JSON parse (defensive)
    const t = await req.text();
    return JSON.parse(t);
  }
}

function pickEvent(raw: any): HSArrive {
  // HubSpot can POST an array of events. Take the first “convo” style item.
  if (Array.isArray(raw)) {
    const first =
      raw.find(
        (it) =>
          (it?.subscriptionType || "").includes("conversation") ||
          it?.messageType === "MESSAGE",
      ) || raw[0];
    return (first || {}) as HSArrive;
  }
  return (raw || {}) as HSArrive;
}

function extractShallow(ev: HSArrive) {
  // Shallow info we can see directly in the event
  const subscriptionType = ev.subscriptionType;
  const objectId = ev.objectId;
  const messageId =
    ev?.message?.id ||
    // Some hubs put messageId at top-level or under slightly different keys; leave room:
    (ev as any).messageId ||
    (ev as any).id;

  const subject = ev.subject || "your message to Alex-IO";

  return { subscriptionType, objectId, messageId, subject };
}

export async function GET() {
  // Simple “up” check keeps your 200 OK status test happy.
  return NextResponse.json({ ok: true, method: "GET" });
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const base = getBaseUrl(req);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  let raw: any;
  try {
    raw = await readJson(req);
  } catch (e) {
    // Always 200 for HubSpot, but report the parse error
    return NextResponse.json(
      { ok: false, error: "json_parse_failed", detail: String(e) },
      { status: 200 },
    );
  }

  const ev = pickEvent(raw);
  const { subscriptionType, objectId, messageId, subject } = extractShallow(ev);

  // Lightweight log snapshot
  console.log("[webhook] ARRIVE {");
  console.log(
    "  subtype:",
    JSON.stringify(
      { subscriptionType, messageType: ev?.messageType ?? null, changeFlag: ev?.changeFlag ?? null },
    ),
  );
  console.log("}");

  // If we don't even have a messageId, we can't look up the email/text
  if (!messageId) {
    console.log(
      "[webhook] IGNORE missing { toEmail: false , text: false } (no messageId; objectId=%s)",
      objectId ?? "null",
    );
    return NextResponse.json(
      {
        ok: true,
        ignored: true,
        reason: "missing messageId",
        ms: Date.now() - t0,
      },
      { status: 200 },
    );
  }

  // === Deep lookup: get toEmail + text ===
  let toEmail: string | undefined;
  let text: string | undefined;

  try {
    const body = {
      subscriptionType: subscriptionType || "conversation.newMessage",
      messageId,
      objectId,
    };
    const res = await fetch(`${base}/api/hubspot/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Avoid wedging webhook on slow lookups
      cache: "no-store",
    });

    let data: any = {};
    try {
      data = await res.json();
    } catch {
      // if lookup returns non-json
      const txt = await res.text();
      data = { ok: false, body: txt };
    }

    if (data?.ok !== false) {
      toEmail = data?.toEmail || data?.email || data?.fromEmail;
      text = data?.text || data?.message || data?.body;
    }

    console.log(
      "[webhook] shallow extract -> %s",
      JSON.stringify({
        hasEmail: !!toEmail,
        hasText: !!text,
        messageId,
      }),
    );
  } catch (e) {
    console.log("[webhook] lookup error:", String(e));
    // Still return 200 to keep HubSpot green
    return NextResponse.json(
      {
        ok: false,
        error: "lookup_failed",
        detail: String(e),
        ms: Date.now() - t0,
      },
      { status: 200 },
    );
  }

  if (!toEmail || !text) {
    console.log(
      "[webhook] IGNORE missing { toEmail: %s , text: %s }",
      !!toEmail,
      !!text,
    );
    return NextResponse.json(
      {
        ok: true,
        ignored: true,
        reason: "missing toEmail or text",
        ms: Date.now() - t0,
      },
      { status: 200 },
    );
  }

  // === Dry-run echo (no send) ===
  if (dryRun) {
    console.log("[webhook] DRY RUN -> would orchestrate");
    return NextResponse.json(
      {
        ok: true,
        dryRun: true,
        toEmail,
        subject: `Re: ${subject}`,
        preview: text?.slice(0, 120),
        ms: Date.now() - t0,
      },
      { status: 200 },
    );
  }

  // === Live handoff to AI orchestrator ===
  try {
    const payload = {
      mode: "ai",
      toEmail,
      inReplyTo: messageId,
      subject: `Re: ${subject}`,
      text,
      // Give the AI a gentle nudge to behave like a quoting assistant:
      ai: {
        task:
          "Act like a helpful estimator for protective foam packaging. Ask crisp questions if needed and move toward a quote.",
        hints: [
          "If user gives dimensions, confirm density and thickness under part",
          "Keep replies <= 120 words unless providing a price/estimate",
        ],
      },
      dryRun: false,
    };

    const r = await fetch(`${base}/api/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const body = await r.json().catch(async () => ({ raw: await r.text() }));

    console.log("[webhook] orchestrate ->", {
      status: r.status,
      ok: (body as any)?.ok ?? r.ok,
      route: "/api/ai/orchestrate",
    });

    return NextResponse.json(
      {
        ok: true,
        forwarded: true,
        orchestrate: { status: r.status, ok: (body as any)?.ok ?? r.ok },
        ms: Date.now() - t0,
      },
      { status: 200 },
    );
  } catch (e) {
    console.log("[webhook] orchestrate error:", String(e));
    // Keep HubSpot green but report the failure back
    return NextResponse.json(
      { ok: false, error: "orchestrate_failed", detail: String(e) },
      { status: 200 },
    );
  }
}
