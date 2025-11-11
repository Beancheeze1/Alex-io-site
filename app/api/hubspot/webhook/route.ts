// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts } from "@/app/lib/memory";

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

/* ------------------- helpers ------------------- */

// Normalize IDs (strip <>, trim, lowercase). If very long, hash to a short stable id.
function normalizeId(s?: string): string {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const noAngles = raw.replace(/^<|>$/g, "").trim().toLowerCase();
  if (!noAngles) return "";
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

// Sleep helper for one-shot retry
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

/** Map a raw object from HubSpot into our HubSpotEvent shape. */
function mapToEvent(o: any): HubSpotEvent {
  const sub =
    o?.subscriptionType ?? o?.subscription_type ?? o?.eventType ?? "";
  const oid =
    o?.objectId ?? o?.objectID ?? o?.threadId ?? o?.id ?? o?.subjectId ?? o?.resourceId;
  const mid =
    o?.messageId ?? o?.messageID ?? o?.msgId ?? (typeof o?.id === "string" ? o.id : undefined);
  const chg = o?.changeFlag ?? o?.change ?? o?.eventType ?? "";

  return {
    subscriptionType: typeof sub === "string" ? sub : String(sub || ""),
    objectId: typeof oid === "number" || typeof oid === "string" ? oid : undefined,
    messageId: typeof mid === "string" ? mid : undefined,
    changeFlag: typeof chg === "string" ? chg : undefined,
  };
}

/**
 * Normalize any HubSpot payload (object, array, or wrapper) into a list of events.
 * Supports:
 *  - single event object (as seen in HubSpot Monitoring)
 *  - array of events
 *  - wrappers with `events` or `results`
 */
function normalizeHubSpotEvents(body: any): { events: HubSpotEvent[]; shape: string; keys: string[] } {
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  const out: HubSpotEvent[] = [];

  if (Array.isArray(body)) {
    for (const item of body) out.push(mapToEvent(item));
    return { events: out, shape: "array", keys: [] };
  }

  if (body && typeof body === "object") {
    // common wrappers
    if (Array.isArray(body.events)) {
      for (const item of body.events) out.push(mapToEvent(item));
      return { events: out, shape: "wrapper.events", keys };
    }
    if (Array.isArray(body.results)) {
      for (const item of body.results) out.push(mapToEvent(item));
      return { events: out, shape: "wrapper.results", keys };
    }

    // single object (Monitoring page shows this form)
    out.push(mapToEvent(body));
    return { events: out, shape: "object", keys };
  }

  return { events: [], shape: "unknown", keys: [] };
}

/* ----------------------------- route ----------------------------- */

export async function POST(req: NextRequest) {
  const replyEnabled = (process.env.ALEXIO_REPLY_ENABLED ?? "true").toLowerCase() === "true";

  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const urlLookup = `${base}/api/hubspot/lookupEmail`;
  const urlOrchestrate = `${base}/api/ai/orchestrate`;

  try {
    const raw = await parseJSON(req);
    const { events, shape, keys } = normalizeHubSpotEvents(raw);

    if (!events.length) {
      // Never 400 here; tell HubSpot we accepted it but didn't act.
      console.warn("[webhook] unsupported_shape", { shape, keys });
      return ok({ send_ok: false, reason: "unsupported_shape", shape, keys });
    }

    // Prefer a conversation.newMessage if present; else take first
    const ev =
      events.find(e => String(e?.subscriptionType || "").toLowerCase().includes("conversation.newmessage")) ||
      events[0];

    const objectId = String(ev?.objectId ?? "").trim();
    const messageId = String(ev?.messageId ?? "").trim();

    console.log("[webhook] received", {
      shape,
      keys,
      subscriptionType: ev?.subscriptionType || "",
      objectId: objectId || 0,
      messageId: messageId || "",
      changeFlag: ev?.changeFlag || "",
      replyEnabled,
    });

    const lookupOnce = async () => {
  const qs: string[] = [];
  if (objectId) qs.push(`objectId=${encodeURIComponent(objectId)}`);
  if (messageId) qs.push(`messageId=${encodeURIComponent(messageId)}`); // <<< NEW
  const lookupURL = qs.length ? `${urlLookup}?${qs.join("&")}` : urlLookup;
  const res = await fetch(lookupURL, { method: "GET", cache: "no-store" });
  const j = await res.json().catch(() => ({} as any));
  return { res, j, url: lookupURL };
};


    let { res: lookupRes, j: lookup, url: lookupURL } = await lookupOnce();

// ALWAYS key by HubSpot conversation id when present.
// This guarantees a single Redis key across the whole thread.
const threadIdCanonical =
  objectId
    ? `hs:${normalizeId(objectId)}`
    : canonicalThreadId({
        lookupThreadId: String(lookup?.threadId || ""),
        objectId: "", // (we already handled objectId)
        inReplyTo: String(lookup?.inReplyTo || ""),
        messageId: String(lookup?.messageId || messageId || ""),
      });


    if (!threadIdCanonical) {
      console.log("[webhook] missing_threadId", { objectId, lookupKeys: Object.keys(lookup || {}) });
      return ok({ dryRun: false, send_ok: false, reason: "missing_threadId" });
    }

    // Idempotency / duplicate guard
    if (messageId) {
      const mem = await loadFacts(threadIdCanonical).catch(() => ({} as any));
      const last = String((mem && mem.__lastMessageId) || "");
      if (last && last === messageId) {
        console.log("[webhook] skip_duplicate", { threadId: threadIdCanonical, messageId });
        return ok({
          dryRun: false,
          send_ok: false,
          reason: "duplicate_message",
          threadId: threadIdCanonical,
          messageId,
        });
      }
    }

  // Resolve recipient (with retries for HubSpot participant indexing lag)
let toEmail = String(lookup?.email || "").trim();
const subject = String(lookup?.subject || "Re: your foam quote request");
const textRaw = String(lookup?.text || "");

if (!toEmail) {
  const waits = [10_000, 25_000]; // ~10s then ~25s
  for (const ms of waits) {
    console.log("[webhook] missing_toEmail_retry_after", ms, {
      url: lookupURL,
      httpOk: lookupRes.ok,
      status: lookupRes.status,
    });
    await delay(ms);
    ({ res: lookupRes, j: lookup, url: lookupURL } = await lookupOnce());
    toEmail = String(lookup?.email || "").trim();
    if (toEmail) break;
  }

  if (!toEmail) {
    console.log("[webhook] missing_toEmail_after_retries", {
      url: lookupURL,
      httpOk: lookupRes.ok,
      status: lookupRes.status,
      jsonKeys: Object.keys(lookup || {}),
    });
    return ok({
      dryRun: false,
      send_ok: false,
      toEmail: "",
      reason: "missing_toEmail_after_retries",
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
}


    if (!replyEnabled) {
      return ok({
        dryRun: true,
        replyEnabled,
        toEmail,
        threadId: threadIdCanonical,
        preview: (textRaw || "").slice(0, 500),
      });
    }

    const orchBody = {
      mode: "ai",
      toEmail,
      subject,
      text: textRaw,
      threadId: threadIdCanonical,  // ***stable key used by memory load/save***
      dryRun: false,
    };

    console.log("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:false , threadKey:", threadIdCanonical, "}");
    const orchRes = await fetch(`${urlOrchestrate}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orchBody),
      cache: "no-store",
    });
    const orchJson = await orchRes.json().catch(() => ({} as any));

    // Update last processed message id on success
    if ((orchRes.ok || orchJson?.sent) && messageId) {
      try {
        const mem = await loadFacts(threadIdCanonical).catch(() => ({} as any));
        await saveFacts(threadIdCanonical, { ...(mem || {}), __lastMessageId: messageId });
      } catch (e) {
        console.warn("[webhook] save_lastMessageId_failed", String((e as any)?.message || e));
      }
    }

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
    // Important: still 200 to avoid HubSpot retry storms; report error in body.
    return err("webhook_exception", String(e?.message || e));
  }
}
