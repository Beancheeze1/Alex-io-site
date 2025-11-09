// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LookupOut = {
  ok: boolean;
  email?: string;
  subject?: string;
  text?: string;
  threadId?: number;
  error?: string;
  status?: number;
  detail?: string;
  src?: any;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Prefer env but auto-derive external origin so we never hit localhost. */
function baseUrl(req: NextRequest) {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function boolQuery(req: NextRequest, key: string) {
  const v = (req.nextUrl.searchParams.get(key) || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function log(label: string, obj: any) {
  try {
    console.log(label, JSON.stringify(obj, null, 2));
  } catch {
    console.log(label, obj);
  }
}

export async function POST(req: NextRequest) {
  // visual divider in Render logs
  console.log("////////////////////////////////////////////////////////");

  // ---- Parse the HubSpot webhook envelope (don’t throw on odd shapes)
  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    // If HubSpot retries with odd body, keep moving; we’ll require objectId later
  }

  // HubSpot can send batches; we only need objectId here
  let objectId: number = 0;
  if (typeof payload?.objectId === "number") {
    objectId = payload.objectId;
  } else if (Array.isArray(payload) && payload.length && typeof payload[0]?.objectId === "number") {
    objectId = payload[0].objectId;
  } else if (typeof payload?.eventId === "number" && typeof payload?.subscriptionType === "string") {
    // Some portals send sparse bodies; lookup route will still work with threadId we already tested
    objectId = Number(payload?.threadId || payload?.objectId || 0);
  }

  const subscriptionType =
    (payload?.subscriptionType as string) ||
    (Array.isArray(payload) ? payload[0]?.subscriptionType : "") ||
    "conversation.newMessage";

  log("[webhook] received", {
    subscriptionType,
    objectId,
    messageType: payload?.messageType || (Array.isArray(payload) ? payload[0]?.messageType : undefined),
    changeFlag: payload?.changeFlag || (Array.isArray(payload) ? payload[0]?.changeFlag : undefined),
  });

  // controls
  const dryRun = boolQuery(req, "dryRun");
  const replyEnabled = (process.env.REPLY_ENABLED || "false").toLowerCase() === "true";

  // ---- Lookup customer email/subject/text via the working helper route
  const traces: any[] = [];
  const base = baseUrl(req);
  const lookupUrl = `${base}/api/hubspot/lookupEmail?t=${Math.random()}`;

  let toEmail = "";
  let subj = "";
  let txt = "";
  let inReplyTo: string | null = null;

  try {
    const r = await fetch(lookupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The helper supports { objectId } (your PowerShell confirms)
      body: JSON.stringify({ objectId }),
      cache: "no-store",
    });

    const httpOk = r.ok;
    const httpStatus = r.status;
    let j: LookupOut | null = null;
    try {
      j = (await r.json()) as LookupOut;
    } catch (e) {
      j = null;
    }

    traces.push({
      path: "/api/hubspot/lookupEmail",
      url: lookupUrl,
      httpOk,
      status: httpStatus,
      jsonOk: j?.ok ?? null,
      jsonKeys: j ? Object.keys(j) : null,
    });

    if (!httpOk) {
      const res = {
        ok: true,
        dryRun,
        send_ok: false,
        toEmail: "",
        reason: "lookup_http_error",
        lookup_traces: traces,
      };
      log("[webhook] lookupEmail status_error", res);
      return NextResponse.json(res, { status: 200 });
    }

    if (!j?.ok) {
      const res = {
        ok: true,
        dryRun,
        send_ok: false,
        toEmail: "",
        reason: "lookup_json_not_ok",
        lookup_traces: traces,
      };
      log("[webhook] lookupEmail json_error", res);
      return NextResponse.json(res, { status: 200 });
    }

    // ✅ Source of truth: use the JSON fields the helper returns
    toEmail = String(j.email || "").trim();
    subj = String(j.subject || "").trim();
    txt = String(j.text || "").trim();

    // The helper sometimes includes a threadId; we can also pass inReplyTo if you store it
    // (HubSpot payloads include messageId of last inbound; wire it if you want)
    inReplyTo = payload?.messageId ? String(payload.messageId) : null;
  } catch (err: any) {
    const res = {
      ok: true,
      dryRun,
      send_ok: false,
      toEmail: "",
      reason: "lookup_exception",
      error: String(err?.message || err),
      lookup_traces: traces,
    };
    log("[webhook] lookup_exception", res);
    return NextResponse.json(res, { status: 200 });
  }

  if (!toEmail) {
    const res = {
      ok: true,
      dryRun,
      send_ok: false,
      toEmail: "",
      reason: "missing_toEmail",
      lookup_traces: traces,
    };
    log("[webhook] missing_toEmail", res);
    return NextResponse.json(res, { status: 200 });
  }

  // ---- If replies are disabled or ?dryRun=1, report that explicitly
  if (!replyEnabled || dryRun) {
    const res = {
      ok: true,
      dryRun,
      send_ok: true,
      toEmail,
      info: !replyEnabled ? "reply_disabled" : "dry_run",
      lookup_traces: traces,
    };
    log("[webhook] done (skipped send)", res);
    return NextResponse.json(res, { status: 200 });
  }

  // ---- Orchestrate → Graph send
  const orchUrl = `${base}/api/ai/orchestrate?t=${Math.random()}`;
  const ms = Date.now();
  let sent = false;
  let sendDetail: any = {};

  try {
    const body = {
      mode: "ai" as const,
      toEmail,
      subject: subj,
      text: txt,
      inReplyTo,
      dryRun: false,
    };

    const r = await fetch(orchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const httpOk = r.ok;
    const httpStatus = r.status;
    let j: any = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }

    traces.push({
      path: "/api/ai/orchestrate",
      url: orchUrl,
      httpOk,
      status: httpStatus,
      jsonOk: j?.ok ?? null,
      jsonKeys: j ? Object.keys(j) : null,
    });

    sent = httpOk && (j?.ok ?? false);
    sendDetail = { httpOk, httpStatus, j };
  } catch (err: any) {
    sendDetail = { error: String(err?.message || err) };
    sent = false;
  }

  const res = {
    ok: true,
    dryRun,
    send_ok: sent,
    toEmail,
    ms: Date.now() - ms,
    lookup_traces: traces,
    send_detail: sendDetail,
  };
  log("[webhook] done", res);
  return NextResponse.json(res, { status: 200 });
}
