// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Helpers */
function boolEnv(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(s);
}

type LookupOut = {
  ok: boolean;
  email?: string;
  subject?: string;
  text?: string;
  error?: string;
  status?: number;
  detail?: string;
  src?: any;
  threadId?: number;
};

function getOriginFromReq(req: Request): string {
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    // Absolute last-resort fallback if req.url is ever malformed.
    // Prefer configured public base if present; otherwise do NOT use localhost.
    const envBase = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL;
    if (envBase) return envBase.replace(/\/+$/, "");
    throw new Error("Cannot derive request origin and no BASE_URL is set");
  }
}

/** Route */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const isDryRun = url.searchParams.get("dryRun") === "1";
  const REPLY_ENABLED = boolEnv("REPLY_ENABLED", true);

  // Read payload safely
  let payload: any = {};
  try {
    payload = await req.json().catch(() => ({}));
  } catch {
    payload = {};
  }

  const objectId = Number(payload.objectId ?? payload.threadId ?? 0);
  if (!objectId) {
    return NextResponse.json(
      { ok: false, error: "missing objectId or threadId" },
      { status: 200 }
    );
  }

  // ---- Bullet-proof origin for internal call
  const origin = getOriginFromReq(req);

  // Call lookupEmail **at the same origin** (Render), never localhost.
  const lookupUrl = `${origin}/api/hubspot/lookupEmail?t=${Date.now()}`;
  const lookupReqBody = JSON.stringify({ objectId });

  const lookup_traces: Array<{ path: string; url: string; ok: boolean; status: number }> = [];

  let toEmail = "";
  let subject = "";
  let text = "";
  let threadId: number | undefined = undefined;

  try {
    const r = await fetch(lookupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: lookupReqBody,
      cache: "no-store",
      // small timeout guard
      // @ts-ignore
      next: { revalidate: 0 },
    });

    const j = (await r.json().catch(() => ({}))) as LookupOut;

    lookup_traces.push({ path: "/api/hubspot/lookupEmail", url: lookupUrl, ok: !!j?.ok, status: r.status });

    if (j?.ok) {
      toEmail = String(j.email || "");
      subject = String(j.subject || "");
      text = String(j.text || "");
      threadId = j.threadId ?? objectId;
    }
  } catch (err) {
    lookup_traces.push({ path: "/api/hubspot/lookupEmail", url: lookupUrl, ok: false, status: 0 });
  }

  if (!toEmail) {
    const res = {
      ok: true,
      dryRun: isDryRun,
      send_ok: false,
      reason: "missing_toEmail",
      lookup_traces,
    };
    console.log("[webhook] missing_toEmail", res);
    return NextResponse.json(res, { status: 200 });
  }

  // If this is a dry run, stop here with success so we can prove lookup is fixed.
  if (isDryRun) {
    const res = {
      ok: true,
      dryRun: true,
      send_ok: true,
      reason: "send_ok",
      toEmail,
      subject,
      text,
      threadId,
      lookup_traces,
    };
    console.log("[webhook] dryRun OK", res);
    return NextResponse.json(res, { status: 200 });
  }

  if (!REPLY_ENABLED) {
    const res = {
      ok: true,
      dryRun: false,
      send_ok: false,
      reason: "reply_disabled",
      toEmail,
      subject,
      text,
      threadId,
      lookup_traces,
    };
    console.log("[webhook] reply disabled", res);
    return NextResponse.json(res, { status: 200 });
  }

  // ---- Real send via Graph (calls your existing route)
  try {
    const sendUrl = `${origin}/api/msgraph/send?t=${Date.now()}`;
    const body = JSON.stringify({
      mode: "live",
      toEmail,
      subject,
      text,
    });

    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      // @ts-ignore
      next: { revalidate: 0 },
    });

    const j = await r.json().catch(() => ({}));

    const ok = r.ok && (j?.ok === true || r.status === 202);
    const res = {
      ok,
      dryRun: false,
      send_ok: ok,
      reason: ok ? "send_ok" : "send_failed",
      toEmail,
      subject,
      text,
      threadId,
      lookup_traces,
      msgraph_status: r.status,
    };
    console.log("[webhook] send result", res);
    return NextResponse.json(res, { status: 200 });
  } catch (err: any) {
    const res = {
      ok: false,
      dryRun: false,
      send_ok: false,
      reason: "send_exception",
      error: err?.message || String(err),
      toEmail,
      subject,
      text,
      threadId,
      lookup_traces,
    };
    console.error("[webhook] send exception", res);
    return NextResponse.json(res, { status: 200 });
  }
}
