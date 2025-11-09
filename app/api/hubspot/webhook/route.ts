// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --------- small helpers (no behavior changes elsewhere) ---------
function boolEnv(name: string, d = false): boolean {
  const v = process.env[name];
  if (!v) return d;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function baseUrlFrom(req: NextRequest): string {
  // Prefer configured public base; otherwise derive from the incoming request.
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  const u = new URL(req.url);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}

type LookupOut = {
  ok: boolean;
  email?: string;
  subject?: string;
  text?: string;
  threadId?: number | string;
  error?: string;
  status?: number;
  detail?: string;
  src?: any;
};

type WebhookEvent = {
  subscriptionType?: string;
  objectId?: number | string;
  messageType?: string;
  changeFlag?: string;
  // HubSpot sometimes nests extra fields; we keep it open-ended.
  [k: string]: any;
};

// Simple retry: until email is non-empty or we run out of attempts.
async function getEmailWithRetry(
  url: string,
  body: any,
  attempts = 6,             // total tries
  firstDelayMs = 0,         // try immediately
  stepMs = 750              // then 0.75s, 1.5s, 2.25s, ...
): Promise<{ found: boolean; data?: LookupOut; traces: any[] }> {
  const traces: any[] = [];
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, firstDelayMs + stepMs * (i - 1)));
    const r = await fetch(`${url}/api/hubspot/lookupEmail?t=${Math.random()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });

    let json: any = null;
    let jsonOk = false;
    try {
      json = await r.json();
      jsonOk = true;
    } catch {}

    traces.push({
      attempt: i + 1,
      path: "/api/hubspot/lookupEmail",
      url: `${url}/api/hubspot/lookupEmail`,
      httpOk: r.ok,
      status: r.status,
      jsonOk,
      gotEmail: jsonOk && typeof json?.email === "string" && json.email.length > 0,
      keys: jsonOk ? Object.keys(json) : [],
      src: json?.src,
    });

    if (jsonOk && json?.ok && typeof json?.email === "string" && json.email) {
      return { found: true, data: json as LookupOut, traces };
    }
  }
  return { found: false, traces };
}

// ----------------------------- ROUTE ------------------------------
export async function POST(req: NextRequest) {
  const replyEnabled = boolEnv("REPLY_ENABLED", false);
  const dryRunParam = req.nextUrl.searchParams.get("dryRun");
  const dryRun = dryRunParam ? ["1","true","yes"].includes(dryRunParam.toLowerCase()) : false;

  // banner for readability in Render logs
  console.log("////////////////////////////////////////////////////////");

  let event: WebhookEvent = {};
  try {
    event = await req.json();
  } catch {
    // keep empty; we’ll log and return OK to avoid retry storms
  }

  const subscriptionType = String(event?.subscriptionType ?? "undefined");
  const objectId = Number(event?.objectId ?? 0);

  console.log("[webhook] received {",
    `subscriptionType: '${subscriptionType}',`,
    `objectId: ${objectId} }`
  );

  // Guardrails: must have an objectId and feature flags must allow sending
  if (!objectId) {
    return NextResponse.json(
      { ok: true, dryRun, send_ok: false, reason: "missing_objectId" },
      { status: 200 }
    );
  }

  if (!replyEnabled) {
    console.log("[webhook] reply disabled by env");
    return NextResponse.json(
      { ok: true, dryRun: true, send_ok: false, reason: "reply_disabled" },
      { status: 200 }
    );
  }

  const BASE = baseUrlFrom(req);

  // 1) Look up customer email (with retry to beat HubSpot eventual consistency)
  const lookupBody = { objectId };
  const { found, data, traces } = await getEmailWithRetry(BASE, lookupBody);

  if (!found || !data?.email) {
    console.log("[webhook] missing_toEmail", {
      ok: true,
      dryRun,
      send_ok: false,
      toEmail: "",
      reason: "missing_toEmail",
      lookup_traces: traces,
    });
    return NextResponse.json(
      { ok: true, dryRun, send_ok: false, toEmail: "", reason: "missing_toEmail", lookup_traces: traces },
      { status: 200 }
    );
  }

  const toEmail = data.email;
  const subject = data.subject ?? "";
  const text = data.text ?? "";

  // 2) Orchestrate AI (your existing AI step). If your AI just mirrors right
  //    now, this will still send—but this is the correct handoff.
  const orchUrl = `${BASE}/api/ai/orchestrate?t=${Math.random()}`;
  const orchPayload = {
    mode: "ai" as const,
    toEmail,
    subject,
    text,
    inReplyTo: null,
    dryRun,
  };

  const orchRes = await fetch(orchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(orchPayload),
  });

  const orchText = await orchRes.text();
  let orchJson: any = {};
  try { orchJson = JSON.parse(orchText); } catch { orchJson = { raw: orchText }; }

  console.log("[orchestrate] msgraph/send { to:", `'${toEmail}'`, "}");
  console.log("[webhook] done {",
    `ok: ${true},`,
    `dryRun: ${dryRun},`,
    `send_ok: ${orchRes.ok},`,
    `toEmail: '${toEmail}',`,
    `ms: ${orchJson?.ms ?? "n/a"},`,
    "lookup_traces:", traces, "}"
  );

  return NextResponse.json(
    {
      ok: true,
      dryRun,
      send_ok: orchRes.ok,
      toEmail,
      lookup_traces: traces,
      orchestrate: { ok: orchRes.ok, status: orchRes.status, bodyKeys: Object.keys(orchJson ?? {}) },
    },
    { status: 200 }
  );
}
