// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --- utils ---
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
function bool(v: any) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
async function postJson(url: string, payload: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// Try to pull fields from multiple possible shapes of HubSpot events
function pluckEmail(evt: any): string | undefined {
  return (
    evt?.message?.from?.email ||
    evt?.from?.email ||
    evt?.sender?.email ||
    evt?.actor?.email ||
    evt?.email ||
    undefined
  );
}
function pluckText(evt: any): string | undefined {
  return (
    evt?.message?.text ||
    evt?.message?.content ||
    evt?.text ||
    evt?.content ||
    undefined
  );
}
function pluckHtml(evt: any): string | undefined {
  return (
    evt?.message?.html ||
    evt?.html ||
    undefined
  );
}
function pluckSubject(evt: any): string {
  return (
    evt?.message?.subject ||
    evt?.subject ||
    "Re: foam quote"
  );
}
function pluckInReplyTo(evt: any): string | null {
  return (
    evt?.message?.inReplyTo ||
    evt?.inReplyTo ||
    evt?.threadId ||
    null
  );
}

export async function POST(req: NextRequest) {
  const base = requireEnv("NEXT_PUBLIC_BASE_URL"); // e.g. https://api.alex-io.com
  const qs = Object.fromEntries(req.nextUrl.searchParams.entries());
  const dryRun = bool(qs["dryRun"]) || false; // default: LIVE SENDS

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    // Some HubSpot deliveries can be batched; keep going with {} and log
    payload = {};
  }

  // HubSpot can batch events; normalize to array
  const events: any[] = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [payload];

  // Process first event that looks like a message
  const evt = events.find(e =>
    (e?.subscriptionType ?? e?.type ?? "").toString().toLowerCase().includes("message")
  ) ?? events[0];

  const toEmail = pluckEmail(evt);
  const subject = pluckSubject(evt);
  const text = pluckText(evt);
  const html = pluckHtml(evt);
  const inReplyTo = pluckInReplyTo(evt);

  console.log("[webhook] received", {
    subType: evt?.subscriptionType ?? evt?.type,
    toEmail,
    hasText: Boolean(text),
    hasHtml: Boolean(html),
    inReplyTo,
    dryRunChosen: dryRun,
  });

  if (!toEmail) {
    console.warn("[webhook] missing toEmail; skipping orchestrate");
    return NextResponse.json({ ok: true, skipped: "missing toEmail" }, { status: 200 });
  }

  // Build orchestrator input
  const orch = {
    mode: "ai" as const,
    toEmail,
    subject,
    text,   // orchestrator will wrap to html if necessary
    html,   // preferred if present
    inReplyTo,
    dryRun, // *** default false so live sends happen ***
  };

  console.log("[webhook] calling orchestrate", { url: `${base}/api/ai/orchestrate`, dryRun: orch.dryRun, toEmail });

  const r = await postJson(`${base}/api/ai/orchestrate`, orch);

  console.log("[webhook] orchestrate result", {
    status: r.status,
    ok: r.ok,
    send_status: r.data?.send_status,
    send_ok: r.data?.send_ok,
    send_result: r.data?.send_result,
  });

  // Always 200 back to HubSpot quickly
  return NextResponse.json(
    {
      ok: true,
      orchestrate: { status: r.status, ok: r.ok },
      send: {
        status: r.data?.send_status,
        ok: r.data?.send_ok,
        result: r.data?.send_result,
      },
    },
    { status: 200 }
  );
}

// For quick header probe (should be 405 when GET)
export async function GET() {
  return NextResponse.json({ ok: false, hint: "POST only" }, { status: 405 });
}
