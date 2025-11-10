// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPLY_ENABLED = (process.env.REPLY_ENABLED || "true").toLowerCase() !== "false";

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}
function err(error: string, detail?: any, status = 200) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}
function baseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
}
function asBool(v: string | null) {
  return v === "1" || v === "true";
}

/** Robustly extract the first HubSpot event from any of their shapes. */
async function extractEvent(req: NextRequest) {
  // Fallbacks from query (useful for manual tests)
  const qs = req.nextUrl.searchParams;
  const qSub = qs.get("subscriptionType") || undefined;
  const qObj = qs.get("objectId") || undefined;
  const qMsg = qs.get("messageId") || undefined;

  let raw: any = undefined;
  let text: string | undefined;

  try {
    // Prefer JSON if possible
    raw = await req.json();
  } catch {
    try {
      text = await req.text();
      if (text && text.trim().length) raw = JSON.parse(text);
    } catch {
      /* ignore */
    }
  }

  // Normalize to first event-like object
  let evt: any = undefined;

  if (raw && typeof raw === "object") {
    if (Array.isArray(raw) && raw.length) {
      evt = raw[0];
    } else if (Array.isArray((raw as any).events) && (raw as any).events.length) {
      evt = (raw as any).events[0];
    } else {
      evt = raw;
    }
  }

  // Final extraction with query-string fallbacks
  const subscriptionType = String(evt?.subscriptionType || qSub || "").trim();
  const objectId = evt?.objectId ?? qObj ?? undefined;
  const messageId = evt?.messageId ?? evt?.eventId ?? qMsg ?? undefined;
  const changeFlag = evt?.changeFlag;

  return {
    event: evt,
    subscriptionType,
    objectId,
    messageId,
    changeFlag,
    rawKeys: evt ? Object.keys(evt) : [],
    hadBody: !!raw,
    hadText: !!text,
  };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const dryRun = asBool(req.nextUrl.searchParams.get("dryRun"));
    const { event, subscriptionType, objectId, messageId, changeFlag, rawKeys, hadBody, hadText } =
      await extractEvent(req);

    console.log("[webhook] received", {
      subscriptionType,
      objectId,
      messageId,
      changeFlag,
      dryRun,
      replyEnabled: REPLY_ENABLED,
      rawKeys,
      hadBody,
      hadText,
    });

    if (!subscriptionType) {
      // Nothing recognizable—ack so HubSpot doesn't retry, but expose what we saw
      return ok({ ignored: true, reason: "missing_subscriptionType", rawKeys, hadBody, hadText });
    }

    if (subscriptionType !== "conversation.newMessage") {
      return ok({ ignored: true, reason: "unsupported_subscription", subscriptionType });
    }

    // Guard: we need the conversation/thread id for memory
    if (!objectId) {
      return ok({ send_ok: false, reason: "missing_objectId", event });
    }

    // 1) Lookup sender + message text from our helper
    const base = baseUrl();
    const lookupUrl = `${base}/api/hubspot/lookupEmail`;
    const lookupRes = await fetch(lookupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ objectId, messageId }),
    });
    const lookup = await lookupRes.json().catch(() => ({}));

    const toEmail: string = String(lookup?.email || "");
    const subject: string = String(lookup?.subject || "Quote");
    const text: string = String(lookup?.text || "");
    const threadMsgs: any[] = Array.isArray(lookup?.threadMsgs) ? lookup.threadMsgs : [];

    const lookupTrace = {
      path: "/api/hubspot/lookupEmail",
      url: lookupUrl,
      httpOk: lookupRes.ok,
      status: lookupRes.status,
      jsonOk: !!lookup,
      gotEmail: !!toEmail,
      keys: Object.keys(lookup || {}),
    };

    if (!toEmail) {
      console.log("[webhook] missing_toEmail", { objectId, messageId, lookupTrace });
      return ok({
        dryRun,
        send_ok: false,
        toEmail: "",
        reason: "missing_toEmail",
        lookup_traces: [lookupTrace],
      });
    }

    // 2) If disabled, still call orchestrate in dryRun to preview memory
    if (dryRun || !REPLY_ENABLED) {
      const orchestrateUrl = `${base}/api/ai/orchestrate`;
      const prevRes = await fetch(orchestrateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "ai",
          toEmail,
          subject,
          text,
          threadId: objectId,     // <-- CRITICAL for memory
          threadMsgs,
          dryRun: true,
        }),
      });
      const preview = await prevRes.json().catch(() => ({}));
      console.log("[webhook] preview", { status: prevRes.status, objectId, toEmail, ms: Date.now() - t0 });
      return ok({
        ok: true,
        dryRun: true,
        send_ok: true,
        toEmail,
        threadId: objectId,
        lookup_traces: [lookupTrace],
        preview_status: prevRes.status,
        preview,
      });
    }

    // 3) Real send via orchestrator (which sends msgraph)
    const orchestrateUrl = `${base}/api/ai/orchestrate`;
    const orchRes = await fetch(orchestrateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        mode: "ai",
        toEmail,
        subject,
        text,
        threadId: objectId,       // <-- CRITICAL for memory
        threadMsgs,
        dryRun: false,
      }),
    });
    const orchJson = await orchRes.json().catch(() => ({}));

    console.log("[webhook] done", {
      ok: true,
      dryRun: false,
      send_ok: true,
      toEmail,
      threadId: objectId,
      ms: Date.now() - t0,
    });

    return ok({
      ok: true,
      dryRun: false,
      send_ok: true,
      toEmail,
      threadId: objectId,
      orchestrate_status: orchRes.status,
      orchestrate_result: orchJson?.result ?? null,
      lookup_traces: [lookupTrace],
    });
  } catch (e: any) {
    console.error("[webhook] exception", e);
    return err("webhook_exception", String(e?.message || e));
  }
}
