// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HubSpotEvent = {
  subscriptionType?: string;   // "conversation.newMessage"
  objectId?: number | string;  // HubSpot conversation (thread) id
  messageId?: string;
  changeFlag?: string;         // "NEW_MESSAGE"
};

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}
function err(error: string, detail?: any, status = 200) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

// ---------- NEW (tiny helpers) ----------
// Normalize IDs (strip <>, trim, lowercase). If very long, hash to a short stable id.
function normalizeId(s?: string): string {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const noAngles = raw.replace(/^<|>$/g, "").trim().toLowerCase();
  if (!noAngles) return "";
  // If it's enormous or has spaces, make a compact stable token
  if (noAngles.length > 120 || /\s/.test(noAngles)) {
    // Tiny, deterministic hash (FNV-1a 32-bit)
    let h = 0x811c9dc5;
    for (let i = 0; i < noAngles.length; i++) {
      h ^= noAngles.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return `h:${h.toString(16)}`;
  }
  return noAngles;
}

// Build ONE canonical thread id with a clear priority order.
// 1) lookup.threadId (most authoritative if provided by your normalizer)
// 2) HubSpot conversation objectId (stable thread identifier)
// 3) inReplyTo (SMTP)
// 4) messageId (SMTP)
function canonicalThreadId(input: {
  lookupThreadId?: string;
  objectId?: string;
  inReplyTo?: string;
  messageId?: string;
}): string {
  return (
    normalizeId(input.lookupThreadId) ||
    normalizeId(input.objectId) ||
    normalizeId(input.inReplyTo) ||
    normalizeId(input.messageId) ||
    ""
  );
}
// ---------- /NEW ----------

// parse body as JSON or text-JSON
async function parseJSON(req: NextRequest): Promise<any> {
  try {
    const j = await req.json();
    if (j && typeof j === "object") return j;
  } catch {}
  try {
    const t = await req.text();
    if (!t) return {};
    let s = t.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
    if (s.startsWith("{") && s.endsWith("}")) return JSON.parse(s);
  } catch {}
  return {};
}

export async function POST(req: NextRequest) {
  // simple “replyEnabled” flag (you were toggling this earlier)
  const replyEnabled = (process.env.ALEXIO_REPLY_ENABLED ?? "true").toLowerCase() === "true";

  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const urlLookup = `${base}/api/hubspot/lookupEmail`;
  const urlOrchestrate = `${base}/api/ai/orchestrate`;

  try {
    const body = await parseJSON(req);

    // HubSpot can batch events; handle both array and single
    const events: HubSpotEvent[] = Array.isArray(body) ? body : [body];

    // Pick the first conversation.newMessage event
    const ev =
      events.find(e => (e?.subscriptionType || "").toLowerCase().includes("conversation.newmessage")) ||
      events[0] || {};

    const objectId = String(ev?.objectId ?? "").trim(); // prefer conversation id as stable threadId
    const messageId = String(ev?.messageId ?? "").trim();

    // BASIC LOG (kept compact to avoid log spam)
    console.log("[webhook] received", {
      subscriptionType: ev?.subscriptionType || "",
      objectId: objectId || 0,
      messageId: messageId || "",
      changeFlag: ev?.changeFlag || "",
      replyEnabled,
    });

    // Always call our normalizer to get { email, subject, text, threadId, inReplyTo, messageId }
    // We pass objectId when we have it; the handler already knows how to find last message.
    const lookupURL = objectId ? `${urlLookup}?objectId=${encodeURIComponent(objectId)}` : urlLookup;
    const lookupRes = await fetch(lookupURL, { method: "GET", cache: "no-store" });
    const lookup = await lookupRes.json().catch(() => ({} as any));

    const toEmail = String(lookup?.email || process.env.MS_MAILBOX_FROM || "").trim();
    const subject = String(lookup?.subject || "Re: your foam quote request");
    const textRaw = String(lookup?.text || "");

    // ---------- CHANGED: compute ONE canonical thread id ----------
    const threadIdCanonical = canonicalThreadId({
      lookupThreadId: String(lookup?.threadId || ""),
      objectId: objectId,
      inReplyTo: String(lookup?.inReplyTo || ""), // if your lookup populates this
      messageId: String(lookup?.messageId || messageId || ""),
    });
    // --------------------------------------------------------------

    // Guardrails
    if (!toEmail) {
      console.log("[webhook] missing_toEmail", {
        httpOk: lookupRes.ok,
        status: lookupRes.status,
      });
      return ok({
        dryRun: false,
        send_ok: false,
        toEmail: "",
        reason: "missing_toEmail",
        lookup_trace: {
          path: "/api/hubspot/lookupEmail",
          url: lookupURL,
          httpOk: lookupRes.ok,
          status: lookupRes.status,
          jsonOk: !!lookup && typeof lookup === "object",
          jsonKeys: Object.keys(lookup || {}),
        },
      });
    }
    if (!threadIdCanonical) {
      // We must have a stable key for memory
      console.log("[webhook] missing_threadId", {
        objectId,
        lookupKeys: Object.keys(lookup || {}),
      });
      return ok({
        dryRun: false,
        send_ok: false,
        toEmail,
        reason: "missing_threadId",
      });
    }

    // If reply is disabled, just report what we *would* have done
    if (!replyEnabled) {
      return ok({
        dryRun: true,
        replyEnabled,
        toEmail,
        threadId: threadIdCanonical,       // show canonical id in preview
        preview: (textRaw || "").slice(0, 500),
      });
    }

    // Call orchestrator with stable canonical thread id + normalized text.
    // NOTE: threadMsgs omitted (optional); memory persists on threadId via Redis.
    const orchBody = {
      mode: "ai",
      toEmail,
      subject,
      text: textRaw,                // raw inbound text (or normalized plain text)
      threadId: threadIdCanonical,  // ***stable key used by memory load/save***
      dryRun: false,
    };

    console.log("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:false }");
    const orchRes = await fetch(`${urlOrchestrate}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orchBody),
      cache: "no-store",
    });
    const orchJson = await orchRes.json().catch(() => ({} as any));

    console.log("[webhook] done", {
      ok: orchRes.ok,
      dryRun: false,
      send_ok: !!orchJson?.sent,
      toEmail,
      threadId: threadIdCanonical,
      ms: orchJson?.ms || undefined,
    });

    return ok({
      ok: orchRes.ok,
      dryRun: false,
      send_ok: !!orchJson?.sent,
      toEmail,
      threadId: threadIdCanonical,
      ms: orchJson?.ms || undefined,
    });
  } catch (e: any) {
    console.error("[webhook] exception", e?.message || e);
    return err("webhook_exception", String(e?.message || e));
  }
}
