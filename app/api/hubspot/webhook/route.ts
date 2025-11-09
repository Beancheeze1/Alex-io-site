// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------- helpers ------------------------------- */

function boolEnv(name: string, d = false): boolean {
  const v = process.env[name];
  if (!v) return d;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function baseUrlFrom(req: NextRequest): string {
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
  src?: unknown;
};

type HubSpotEvent = {
  subscriptionType?: string; // e.g., "conversation.newMessage"
  objectId?: number | string; // thread id
  messageId?: string;
  messageType?: string;       // "MESSAGE"
  changeFlag?: string;        // "NEW_MESSAGE"
  [k: string]: any;
};

function normalizeEvents(body: any): HubSpotEvent[] {
  if (Array.isArray(body)) return body as HubSpotEvent[];
  if (body && typeof body === "object") return [body as HubSpotEvent];
  return [];
}

function pickRelevantEvent(events: HubSpotEvent[]): HubSpotEvent | null {
  if (!events.length) return null;
  // Prefer conversation.newMessage; otherwise take the first event with objectId
  const newMsg = events.find(e => String(e.subscriptionType ?? "").includes("conversation.newMessage"));
  if (newMsg) return newMsg;
  const withId = events.find(e => Number(e.objectId ?? 0) > 0);
  return withId ?? events[0];
}

// Retry wrapper for eventual consistency between event and conversations APIs.
async function getEmailWithRetry(
  baseUrl: string,
  body: any,
  attempts = 6,
  firstDelayMs = 0,
  stepMs = 750
): Promise<{ found: boolean; data?: LookupOut; traces: any[] }> {
  const traces: any[] = [];
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, firstDelayMs + stepMs * (i - 1)));
    const res = await fetch(`${baseUrl}/api/hubspot/lookupEmail?t=${Math.random()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });

    let json: any = null;
    let jsonOk = false;
    try {
      json = await res.json();
      jsonOk = true;
    } catch {}

    const gotEmail = jsonOk && typeof json?.email === "string" && json.email.length > 0;

    traces.push({
      attempt: i + 1,
      path: "/api/hubspot/lookupEmail",
      url: `${baseUrl}/api/hubspot/lookupEmail`,
      httpOk: res.ok,
      status: res.status,
      jsonOk,
      gotEmail,
      keys: jsonOk ? Object.keys(json) : [],
      src: json?.src,
    });

    if (jsonOk && json?.ok && gotEmail) {
      return { found: true, data: json as LookupOut, traces };
    }
  }
  return { found: false, traces };
}

/* -------------------------------- route -------------------------------- */

export async function POST(req: NextRequest) {
  const replyEnabled = boolEnv("REPLY_ENABLED", false);
  const dryRunParam = req.nextUrl.searchParams.get("dryRun");
  const dryRun = dryRunParam ? ["1", "true", "yes"].includes(dryRunParam.toLowerCase()) : false;

  console.log("////////////////////////////////////////////////////////");

  // Parse HubSpot payload (can be an array of events)
  let raw: any = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }

  const events = normalizeEvents(raw);
  const selected = pickRelevantEvent(events);

  const subscriptionType = String(selected?.subscriptionType ?? "undefined");
  const objectId = Number(selected?.objectId ?? 0);

  console.log("[webhook] received {",
    `subscriptionType: '${subscriptionType}',`,
    `objectId: ${objectId},`,
    `batchSize: ${events.length} }`
  );

  if (!objectId) {
    // Do not 4xx HubSpot; acknowledge but explain why we didn’t send.
    return NextResponse.json(
      { ok: true, dryRun, send_ok: false, reason: "missing_objectId_or_bad_payload", batchSize: events.length },
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

  // 1) Get customer email (retry a few beats to overcome HubSpot lag)
  const lookupBody = { objectId };
  const { found, data, traces } = await getEmailWithRetry(BASE, lookupBody);

  if (!found || !data?.email) {
    console.log("[webhook] missing_toEmail", {
      ok: true, dryRun, send_ok: false, toEmail: "", reason: "missing_toEmail", lookup_traces: traces
    });
    return NextResponse.json(
      { ok: true, dryRun, send_ok: false, toEmail: "", reason: "missing_toEmail", lookup_traces: traces },
      { status: 200 }
    );
  }

  const toEmail = data.email;
  const subject = data.subject ?? "";
  const text = data.text ?? "";

  // 2) Hand off to AI orchestrator (which will call msgraph/send)
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
      orchestrate: { ok: orchRes.ok, status: orchRes.status, keys: Object.keys(orchJson ?? {}) },
    },
    { status: 200 }
  );
}
