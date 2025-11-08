// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * HubSpot webhook → decide whether to orchestrate a reply.
 *
 * Key rules (merged to match the last known-good zip + our recent edits):
 * - Accept a single event or an array; normalize to an array early (fixes TS error).
 * - dryRun: honor ?dryRun=1 (or true) to simulate the full flow but skip sending.
 * - Extract toEmail directly when present; otherwise, look it up from HubSpot
 *   using the local helper endpoint that worked in your baseline.
 * - Only orchestrate if REPLY_ENABLED=true and we have a toEmail.
 * - Clear logs so Render shows exactly what happened.
 */

export const dynamic = "force-dynamic";

type HubSpotEvent = {
  subscriptionType?: string; // e.g., "conversation.newMessage"
  objectId?: string;         // message/thread object id
  messageId?: string;        // message id (when present)
  inReplyTo?: string | null; // replied-to message id (when present)
  toEmail?: string | null;   // we sometimes set/receive this
  hasText?: boolean;
  hasHtml?: boolean;
  text?: string;
  subject?: string;
  from?: string | null;
};

// ---- helpers ----

function boolFromStr(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env: ${name}`);
}

async function json(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const txt = await res.text();
    return { ok: false, status: res.status, text: txt };
  }
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

function log(header: string, obj: unknown) {
  // Compact, readable server logs
  console.log(`[webhook] ${header}`, typeof obj === "string" ? obj : obj ?? {});
}

/**
 * Normalize the posted body into an array of events.
 */
async function readEvents(req: NextRequest): Promise<HubSpotEvent[]> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return [];
  }
  if (Array.isArray(body)) return body as HubSpotEvent[];
  if (body && typeof body === "object") return [body as HubSpotEvent];
  return [];
}

/**
 * Our local helper (from your working baseline) that can resolve the recipient
 * when HubSpot’s webhook doesn’t include it.
 *
 * We keep it path-relative so it works in Render without external auth.
 */
async function tryLookupToEmailFromMessage(messageId: string): Promise<string | null> {
  try {
    const url = `${getEnv("NEXT_PUBLIC_BASE_URL")}/api/hubspot/messages/${encodeURIComponent(
      messageId
    )}`;
    const res = await fetch(url, { cache: "no-store" });
    const out = await json(res);
    if (!out.ok) {
      log("lookupEmail status_error", out);
      return null;
    }
    const to: string | undefined =
      out.body?.toEmail ||
      out.body?.to_address ||
      out.body?.to?.email ||
      out.body?.to;
    if (to && typeof to === "string" && to.includes("@")) return to.trim();
  } catch (e) {
    log("lookupEmail exception", String(e));
  }
  return null;
}

/**
 * Decide if this event is the kind we reply to.
 * We keep it simple and permissive—same as the baseline:
 * reply on new inbound conversation messages.
 */
function isNewInbound(ev: HubSpotEvent): boolean {
  const t = (ev.subscriptionType || "").toLowerCase();
  // HubSpot fires variants; treat anything that looks like a new inbound as eligible
  return t.includes("conversation.newmessage") || t.includes("conversations.newmessage");
}

// ---- route ----

export async function POST(req: NextRequest) {
  const replyEnabled = boolFromStr(process.env.REPLY_ENABLED);
  const dryRun = boolFromStr(req.nextUrl.searchParams.get("dryRun"));

  // Read & normalize events (FIX: never treat union as array; we always produce an array here)
  const events = await readEvents(req);

  if (!events.length) {
    log("received (empty body)", {});
    return NextResponse.json({ ok: true, dryRun, send_ok: false, reason: "no_events" });
  }

  // We only consider the first eligible inbound event (same as baseline behavior)
  let chosen: HubSpotEvent | null = null;
  for (const ev of events) {
    if (isNewInbound(ev)) {
      chosen = ev;
      break;
    }
  }

  if (!chosen) {
    log("received (non-inbound/no eligible event)", { count: events.length });
    return NextResponse.json({ ok: true, dryRun, send_ok: false, reason: "no_eligible_event" });
  }

  // Extract details from the chosen event
  const subType = chosen.subscriptionType || "unknown";
  let toEmail: string | null =
    (chosen.toEmail && chosen.toEmail.includes("@") ? chosen.toEmail : null) || null;

  const inReplyTo = chosen.inReplyTo || chosen.messageId || chosen.objectId || null;
  const hasText = Boolean(chosen.hasText ?? chosen.text);
  const hasHtml = Boolean(chosen.hasHtml);

  log("received", {
    subType,
    toEmail,
    hasText,
    hasHtml,
    inReplyTo,
    dryRunChosen: dryRun,
  });

  // If HubSpot body didn’t include the recipient, look it up the same way the baseline did.
  if (!toEmail && inReplyTo) {
    toEmail = await tryLookupToEmailFromMessage(inReplyTo);
  }

  if (!toEmail) {
    log("missing toEmail; skipping orchestrate", {});
    return NextResponse.json({
      ok: true,
      dryRun,
      send_ok: false,
      reason: "missing_toEmail",
    });
  }

  // Respect the global reply toggle
  if (!replyEnabled) {
    log("REPLY_DISABLED; skipping send", { replyEnabled });
    return NextResponse.json({
      ok: true,
      dryRun,
      send_ok: false,
      reason: "reply_disabled",
    });
  }

  // Build a lightweight orchestration request to your existing route
  const orchUrl = `${getEnv("NEXT_PUBLIC_BASE_URL")}/api/ai/orchestrate`;
  const payload = {
    mode: "ai" as const,
    toEmail,
    subject: chosen.subject || undefined,
    text: chosen.text || undefined,
    inReplyTo: inReplyTo || undefined,
    dryRun,
  };

  // Send to orchestrator
  let send_status = 0;
  let send_ok = false;
  let send_result: string | undefined;

  try {
    const res = await fetch(`${orchUrl}?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    send_status = res.status;
    const out = await json(res);
    send_ok = Boolean(out.ok);
    // Prefer the orchestrator’s declared send result if present
    // (our tests log {status: 200, ok: true, result: "sent"})
    // fall back to a short summary.
    send_result =
      (out.body && (out.body.result || out.body.send_result)) ||
      (out.ok ? "sent" : "failed");
  } catch (e) {
    log("orchestrate exception", String(e));
    send_result = "exception";
  }

  log("orchestrate result", { status: send_status, ok: send_ok, send_result });

  return NextResponse.json({
    ok: true,
    dryRun,
    send_status,
    send_ok,
    send_result,
  });
}
