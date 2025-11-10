// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HubSpotEvent = {
  subscriptionType?: string;
  objectId?: number | string;
  messageId?: string;
  changeFlag?: string;
};

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}
function fail(error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail }, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const ev: HubSpotEvent | null =
      Array.isArray(body) && body.length ? (body[0] as any) :
      (body && typeof body === "object" ? (body as any) : null);

    if (!ev) return fail("bad_payload");

    const objectId = String(ev.objectId ?? "").trim();
    if (!objectId) return fail("missing_objectId", { ev });

    // 1) ask our lookup to extract email/subject/text for this thread
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const lookupUrl = `${base}/api/hubspot/lookupEmail`;
    const lookupRes = await fetch(lookupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectId }),
      cache: "no-store",
    });
    const lookupJson = await lookupRes.json().catch(() => ({}));

    const toEmail: string = lookupJson?.email || "";
    const subject: string = lookupJson?.subject || "";
    const text: string = lookupJson?.text || "";
    const threadMsgs: any[] = lookupJson?.messages ?? [];

    if (!toEmail) {
      console.log("[webhook] missing_toEmail", {
        objectId,
        status: lookupRes.status,
        jsonKeys: Object.keys(lookupJson || {}),
      });
      return ok({
        dryRun: false,
        send_ok: false,
        toEmail,
        reason: "missing_toEmail",
        lookup_traces: [
          { path: "/api/hubspot/lookupEmail", status: lookupRes.status }
        ],
      });
    }

    // 2) forward to orchestrator with the CRITICAL threadId
    const orchestrateUrl = `${base}/api/ai/orchestrate`;
    const orchPayload = {
      mode: "ai",
      toEmail,
      subject: subject || "Quote",
      text,
      threadId: objectId,     // <<< STABLE KEY FOR MEMORY
      threadMsgs,             // optional context
      dryRun: false,
    };

    const orchRes = await fetch(orchestrateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orchPayload),
      cache: "no-store",
    });

    const orchJson = await orchRes.json().catch(() => ({}));
    console.log("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:false, status:", orchRes.status, "}");

    return ok({
      dryRun: false,
      send_ok: (!!orchRes.ok || orchRes.status === 200 || orchRes.status === 202),
      toEmail,
      status: orchRes.status,
      result: orchJson?.result ?? null,
    });
  } catch (e: any) {
    return fail("webhook_exception", String(e?.message || e));
  }
}
