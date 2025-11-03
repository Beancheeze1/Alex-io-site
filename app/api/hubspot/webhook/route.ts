// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * HubSpot Webhook endpoint
 * - POST only (GET/HEAD -> 405)
 * - Accepts array/object payloads
 * - ?dryRun=1 echoes a stub result and 200
 */

type HSMessage = {
  subscriptionType?: string;
  eventType?: string | null;
  changeFlag?: string;
  messageType?: string;
  message?: { from?: { email?: string | null } | null } | null;
  headers?: Record<string, string>;
  [k: string]: any;
};

function jsonOk(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function methodNotAllowed() {
  return jsonOk({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

export async function GET() {
  return methodNotAllowed();
}

export async function HEAD() {
  return methodNotAllowed();
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // Parse body (HubSpot can send an array or a single object)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonOk({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const arr: HSMessage[] = Array.isArray(body) ? (body as HSMessage[]) : [body as HSMessage];
  const first = arr[0] ?? {};

  const subtype = JSON.stringify({
    subscriptionType: first.subscriptionType,
    eventType: first.eventType ?? null,
    changeFlag: first.changeFlag,
    messageType: first.messageType ?? "MESSAGE",
  });

  if (dryRun) {
    return jsonOk({
      ok: true,
      dryRun: true,
      subtype,
      note: "dryRun=1 -> no side-effects",
    });
  }

  const fromEmail = first?.message?.from?.email ?? null;

  if (!fromEmail) {
    // keep HubSpot green (200) but tell our logs we ignored it
    return jsonOk({
      ok: true,
      ignored: true,
      reason: "no_email",
      subtype,
    });
  }

  // Place your real handling here (e.g., call msgraph/send)
  return jsonOk({
    ok: true,
    received: true,
    fromEmail,
    subtype,
  });
}
