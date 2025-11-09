// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Strong guarantees we never hit localhost.
 * Your rule: always use https://api.alex-io.com
 */
const BASE =
  (process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    "https://api.alex-io.com").replace(/\/+$/, "");

const REPLY_ENABLED = String(process.env.REPLY_ENABLED || "").toLowerCase() === "true";

/** small helper */
async function postJson<T>(
  url: string,
  body: any
): Promise<{ ok: boolean; status: number; json?: T; text?: string }> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // cache must be disabled so logs always emit
      cache: "no-store",
      body: JSON.stringify(body ?? {}),
    });
    const status = r.status;
    const text = await r.text();
    try {
      const json = JSON.parse(text);
      return { ok: r.ok, status, json };
    } catch {
      return { ok: r.ok, status, text };
    }
  } catch {
    return { ok: false, status: 0 };
  }
}

function boolParam(u: URL, name: string, fallback = false) {
  const v = u.searchParams.get(name);
  if (v == null) return fallback;
  return ["1", "true", "yes"].includes(v.toLowerCase());
}

export async function POST(req: Request) {
  // -------- entry log (hard stop if this ever disappears) ----------
  console.log("\n////////////////////////////////////////////");
  console.log("[webhook] entry");

  const started = Date.now();
  const url = new URL(req.url);
  const dryRun = boolParam(url, "dryRun", false) || !REPLY_ENABLED;

  // HubSpot event payload
  const payload: any = await req.json().catch(() => ({}));
  // We only need the thread id/object id for lookup
  const objectId =
    Number(payload?.objectId) ||
    Number(payload?.threadId) ||
    0;

  // Print the raw/essential line so we can always verify what arrived
  console.log(
    "[webhook] received {",
    `subscriptionType: '${payload?.subscriptionType}',`,
    `objectId: ${objectId} }`
  );

  // ------------- Lookup customer email/subject/text ----------------
  const lookupUrl = `${BASE}/api/hubspot/lookupEmail?t=${Date.now()}`;
  const lookupRes = await postJson<{
    ok: boolean;
    email?: string;
    subject?: string;
    text?: string;
  }>(lookupUrl, { objectId });

  const lookupTrace = { path: "/api/hubspot/lookupEmail", url: lookupUrl, ok: lookupRes.ok, status: lookupRes.status };

  if (!lookupRes.ok || !lookupRes.json?.ok) {
    console.log("[webhook] lookupEmail status_error", {
      ok: lookupRes.ok,
      status: lookupRes.status,
    });
    return NextResponse.json(
      {
        ok: true,
        dryRun,
        send_ok: false,
        toEmail: "",
        reason: "lookup_failed",
        lookup_traces: [lookupTrace],
      },
      { status: 200 }
    );
  }

  const toEmail = String(lookupRes.json.email || "");
  const subject = String(lookupRes.json.subject || "");
  const text = String(lookupRes.json.text || "");

  if (!toEmail) {
    // hard, explicit log with trace; this was the previous gap
    console.log("[webhook] missing_toEmail", {
      ok: true,
      dryRun,
      send_ok: false,
      toEmail,
      lookup_traces: [lookupTrace],
    });
    return NextResponse.json(
      {
        ok: true,
        dryRun,
        send_ok: false,
        toEmail: "",
        reason: "missing_toEmail",
        lookup_traces: [lookupTrace],
      },
      { status: 200 }
    );
  }

  // ------------- Orchestrate (AI → Graph send) ---------------------
  const orchUrl = `${BASE}/api/ai/orchestrate?t=${Date.now()}`;
  const orchBody = {
    mode: "ai" as const,
    toEmail,
    subject,
    text,
    inReplyTo: payload?.messageId ?? null,
    dryRun,
  };

  console.log("[orchestrate] msgraph/send { to:", `'${toEmail}'`, ", dryRun:", dryRun, "}");

  const orchRes = await postJson<{ ok: boolean; result?: string }>(orchUrl, orchBody);
  const orchTrace = { path: "/api/ai/orchestrate", url: orchUrl, ok: orchRes.ok, status: orchRes.status };

  const ms = Date.now() - started;

  console.log("[webhook] done {",
    `ok: ${true},`,
    `dryRun: ${dryRun},`,
    `send_ok: ${orchRes.ok},`,
    `toEmail: '${toEmail}',`,
    `ms: ${ms},`,
    "lookup_traces:", [lookupTrace, orchTrace], "}"
  );

  return NextResponse.json(
    {
      ok: true,
      dryRun,
      send_ok: orchRes.ok,
      toEmail,
      ms,
      lookup_traces: [lookupTrace, orchTrace],
    },
    { status: 200 }
  );
}
