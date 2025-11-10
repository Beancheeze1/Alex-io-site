// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}
function err(error: string, detail?: any, status = 200) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}
function baseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
}
function bool(q: string | null): boolean {
  return q === "1" || q === "true";
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    // HubSpot webhook payload (single event)
    // For conversation.newMessage we rely on: objectId (conversation id), messageId, changeFlag, etc.
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Some HubSpot deliveries are arrays; try text then JSON parse
      try {
        const txt = await req.text();
        body = JSON.parse(txt || "{}");
      } catch {}
    }

    const subscriptionType: string = String(body?.subscriptionType || "");
    const objectId = body?.objectId;      // <-- THIS is the conversation/thread id
    const messageId = body?.messageId || body?.eventId;

    const dryRun = bool(req.nextUrl.searchParams.get("dryRun"));
    const replyEnabled = (process.env.REPLY_ENABLED || "true").toLowerCase() !== "false";

    console.log("[webhook] received", {
      subscriptionType,
      objectId,
      messageId,
      dryRun,
      replyEnabled,
    });

    // Only process conversation.newMessage
    if (subscriptionType !== "conversation.newMessage") {
      return ok({ ignored: true, reason: "unsupported_subscription", subscriptionType });
    }

    // 1) Resolve the sender & message text via internal lookup
    const base = baseUrl();
    const lookupUrl = `${base}/api/hubspot/lookupEmail`;
    const lookupRes = await fetch(lookupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        objectId,       // pass conversation id so the lookup can pull the correct thread
        messageId,      // optional: some lookups use this to get the last message text
      }),
    });

    const lookup = await lookupRes.json().catch(() => ({}));

    const toEmail: string = String(lookup?.email || "");
    const subject: string = String(lookup?.subject || "Quote");
    const text: string = String(lookup?.text || "");
    const threadMsgs: any[] = Array.isArray(lookup?.threadMsgs) ? lookup.threadMsgs : [];

    const trace = {
      path: "/api/hubspot/lookupEmail",
      url: lookupUrl,
      httpOk: lookupRes.ok,
      status: lookupRes.status,
      jsonOk: !!lookup,
      gotEmail: !!toEmail,
      keys: Object.keys(lookup || {}),
      src: lookup,
    };

    // If we can't determine the email, bail with an OK (so HubSpot won’t retry)
    if (!toEmail) {
      console.log("[webhook] missing_toEmail", { trace, objectId, messageId });
      return ok({
        dryRun,
        send_ok: false,
        toEmail: "",
        reason: "missing_toEmail",
        lookup_traces: [trace],
      });
    }

    // 2) Short-circuit if user has reply disabled or dryRun was requested
    if (dryRun || !replyEnabled) {
      console.log("[orchestrate] DRYRUN or REPLY_DISABLED", { dryRun, replyEnabled, toEmail });
      // still call orchestrator in dryRun to preview body & confirm memory, but do not actually send
      const orchestrateUrl = `${base}/api/ai/orchestrate`;
      const previewRes = await fetch(orchestrateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "ai",
          toEmail,
          subject,
          text,
          threadId: objectId,   // <<<<<< CRITICAL: persist memory by conversation id
          threadMsgs,
          dryRun: true,
        }),
      });
      const preview = await previewRes.json().catch(() => ({}));
      console.log("[webhook] preview", { status: previewRes.status, toEmail, objectId, ms: Date.now() - t0 });
      return ok({
        ok: true,
        dryRun: true,
        send_ok: true,
        toEmail,
        preview_status: previewRes.status,
        lookup_traces: [trace],
        preview,
      });
    }

    // 3) Real send: call orchestrate (not dryRun)
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
        threadId: objectId,   // <<<<<< CRITICAL: persist memory by conversation id
        threadMsgs,
        dryRun: false,
      }),
    });
    const orchJson = await orchRes.json().catch(() => ({}));

    console.log("[orchestrate] msgraph/send { to:", toEmail, "}", {
      dryRun: false,
      status: orchRes.status,
      threadId: objectId,
    });

    console.log("[webhook] done", {
      ok: true,
      dryRun: false,
      send_ok: true,
      toEmail,
      ms: Date.now() - t0,
    });

    return ok({
      ok: true,
      dryRun: false,
      send_ok: true,
      toEmail,
      lookup_traces: [trace],
      orchestrate_status: orchRes.status,
      orchestrate_result: orchJson?.result ?? null,
      threadId: objectId, // echo for logs
    });
  } catch (e: any) {
    console.error("[webhook] exception", e);
    return err("webhook_exception", String(e?.message || e));
  }
}
