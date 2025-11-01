// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

// Tiny helper: robust truthy parser for envs
function truthy(v: any): boolean {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

type HubspotEnvelope = {
  objectId?: number | string;
  eventType?: string;           // e.g. "conversation.creation" or "conversation.newMessage"
  messageDirection?: string;    // optional, some payloads include direction
  channel?: string;             // optional (e.g., "EMAIL", "CHAT")
  // Your existing shape may be different; we only read the top-level we need.
};

// Safe JSON parse
async function tryJson<T>(req: NextRequest): Promise<{ ok: true; data: T } | { ok: false; err: string }> {
  try {
    const data = await req.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, err: e?.message || String(e) };
  }
}

// Central diagnostic log
function log(section: string, data: Record<string, any>) {
  // Render shows console.log lines; keep compact and explicit
  console.log(`[webhook] ${section}`, JSON.stringify(data));
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";

  // Presence of HubSpot signature indicates real webhook
  const hubspotSig = req.headers.get("X-HubSpot-Signature") ? "present" : "missing";
  const ua = req.headers.get("user-agent") || "";
  const len = Number(req.headers.get("content-length") || "0");
  log("POST hit", { dryRun, len, json: true, ua, hubspotSig });

  // Parse body
  const parsed = await tryJson<HubspotEnvelope | HubspotEnvelope[]>(req);
  if (!parsed.ok) {
    log("JSON parse error", { error: parsed.err });
    return NextResponse.json({ ok: false, error: `bad_json: ${parsed.err}` }, { status: 400 });
  }
  const body = parsed.data;

  // Normalize to a single envelope for logging / decision
  const first: HubspotEnvelope =
    Array.isArray(body) ? (body[0] || {}) : (body as HubspotEnvelope);

  const subType = first?.eventType ?? (first as any)?.subType ?? ""; // support either field name
  const objId = String(first?.objectId ?? (first as any)?.obj ?? "");
  const channel = (first as any)?.channel || "";           // may be empty
  const direction = (first as any)?.messageDirection || ""; // may be empty

  // Pull env flags and show exactly what code is seeing
  const env = {
    REPLY_ENABLED: process.env.REPLY_ENABLED,
    MS_TENANT_ID: !!process.env.MS_TENANT_ID,
    MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: !!process.env.MS_CLIENT_SECRET,
    MS_MAILBOX_FROM: process.env.MS_MAILBOX_FROM,
  };
  const replyEnabled = truthy(env.REPLY_ENABLED);

  log("envelope", { subType, objId, channel, direction });
  log("env", env);
  log("flags", { replyEnabled });

  // === Decision guards (these are the typical bailout points) ===

  // 1) Global gate
  if (!replyEnabled) {
    const note = "reply_disabled";
    log("Responder output", { sent: false, action: "no-responder", note });
    return NextResponse.json({ ok: true, sent: false, action: "no-responder", note });
  }

  // 2) Must be a message event we handle (allow both creation + newMessage)
  const allowed = subType === "conversation.newMessage" || subType === "conversation.creation";
  if (!allowed) {
    const note = `ignore_event:${subType || "unknown"}`;
    log("Responder output", { sent: false, action: "no-responder", note });
    return NextResponse.json({ ok: true, sent: false, action: "no-responder", note });
  }

  // 3) Optional: restrict to email channel if your responder only supports email
  // If your payload doesn’t include channel, this will be empty and pass through.
  // Change this to `channel?.toUpperCase() !== "EMAIL"` if you need that.
  const emailOnly = false; // flip to true if you want to require EMAIL
  if (emailOnly && channel && channel.toUpperCase() !== "EMAIL") {
    const note = `ignore_channel:${channel}`;
    log("Responder output", { sent: false, action: "no-responder", note });
    return NextResponse.json({ ok: true, sent: false, action: "no-responder", note });
  }

  // 4) We need a valid conversation id to fetch text
  if (!objId) {
    const note = "missing_objId";
    log("Responder output", { sent: false, action: "no-responder", note });
    return NextResponse.json({ ok: true, sent: false, action: "no-responder", note });
  }

  // === Fetch the thread/message text (your existing helper) ===
  // If your project already has /api/hubspot/peek-like logic in a util, call it here.
  // For diagnostics, call the existing peek API so we log the outcome.
  // NOTE: replace this with your internal fetch if you have one.

  let messagePreview = "";
  try {
    const peekUrl = new URL(`${url.origin}/api/hubspot/peek`);
    peekUrl.searchParams.set("threadId", objId);
    // pass a cache buster
    peekUrl.searchParams.set("t", String(Date.now()));
    const r = await fetch(peekUrl, { method: "GET", headers: { "accept": "application/json" } });
    const text = await r.text();
    log("peek_result", { status: r.status, bodyLen: text.length, bodySample: text.slice(0, 240) });
    try {
      const j = JSON.parse(text);
      messagePreview = (j?.lastText || j?.text || "").slice(0, 256);
    } catch {
      // keep raw sample only
    }
  } catch (e: any) {
    log("peek_error", { error: e?.message || String(e) });
  }

  if (!messagePreview) {
    const note = "no_message_text";
    log("Responder output", { sent: false, action: "no-responder", note });
    return NextResponse.json({ ok: true, sent: false, action: "no-responder", note });
  }

  // === At this point we would compose and send via Graph ===
  // For safety, keep a dry-run unless you really want to send.
  // Flip `doSend` to true to attempt a real send immediately.
  const doSend = true;

  if (!doSend) {
    const note = "dry_gate";
    log("Responder output", { sent: false, action: "would-send", note, preview: messagePreview });
    return NextResponse.json({ ok: true, sent: false, action: "would-send", note });
  }

  // Minimal Graph call using your existing /api/msgraph/send endpoint
  try {
    const sendUrl = new URL(`${url.origin}/api/msgraph/send`);
    sendUrl.searchParams.set("t", String(Date.now()));
    const payload = {
      to: process.env.MS_MAILBOX_FROM, // send to yourself for now
      subject: "Alex-IO Auto Reply (diag)",
      html: `<p>Auto-detected message on thread ${objId}.</p><pre>${escapeHtml(messagePreview)}</pre>`
    };
    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const t = await r.text();
    log("msgraph_send", { status: r.status, body: t.slice(0, 240) });
    if (r.ok) {
      log("Responder output", { sent: true, action: "sent", note: undefined });
      return NextResponse.json({ ok: true, sent: true, action: "sent" });
    } else {
      log("Responder output", { sent: false, action: "send-failed", note: t.slice(0, 200) });
      return NextResponse.json({ ok: true, sent: false, action: "send-failed", note: t.slice(0, 200) });
    }
  } catch (e: any) {
    const note = e?.message || String(e);
    log("msgraph_error", { error: note });
    log("Responder output", { sent: false, action: "send-exception", note });
    return NextResponse.json({ ok: true, sent: false, action: "send-exception", note });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
