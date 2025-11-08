// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LookupOut = {
  ok: boolean;
  email?: string;
  subject?: string;
  text?: string;
  error?: string;
  status?: number;
  detail?: string;
};

function s(v: unknown) { return String(v ?? "").trim(); }
function yes(v?: string) {
  const t = (v ?? "").toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

async function doLookup(path: string, origin: string, objectId: number): Promise<{trace: any, out: LookupOut}> {
  const url = new URL(path, origin).toString();
  const trace: any = { path, url, ok: false, status: 0 };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ objectId }),
    });
    trace.status = r.status;
    const text = await r.text();
    if (!r.ok) {
      trace.ok = false;
      return { trace, out: { ok: false, status: r.status, error: "lookup_http_error", detail: text.slice(0, 600) } };
    }
    let j: any = {};
    try { j = JSON.parse(text); } catch {
      trace.ok = false;
      return { trace, out: { ok: false, error: "lookup_parse_error", detail: text.slice(0, 600) } };
    }
    trace.ok = true;
    return { trace, out: { ok: true, email: s(j.email), subject: s(j.subject), text: s(j.text) } };
  } catch (err: any) {
    return { trace, out: { ok: false, error: "lookup_exception", detail: err?.message ?? String(err) } };
  }
}

export async function POST(req: NextRequest) {
  const REPLY_ENABLED = yes(process.env.REPLY_ENABLED);
  const dryRunParam = s(req.nextUrl.searchParams.get("dryRun"));
  const dryRun = dryRunParam && dryRunParam !== "0" && dryRunParam.toLowerCase() !== "false";

  let payload: any = {};
  try { payload = await req.json(); } catch { payload = {}; }

  const subType = s(payload.subscriptionType);
  const objectId = Number(payload.objectId ?? payload.threadId ?? 0);
  let toEmail = s(payload.toEmail);
  let subject = s(payload.subject);
  let text = s(payload.text);

  console.log("[webhook] -> entry", {
    subType, objectId, toEmail_present: !!toEmail, hasText: !!text, dryRunChosen: dryRun,
  });

  const origin = req.nextUrl.origin;

  // Always lookup if toEmail is missing (bullet-proof; ignores any env)
  const lookupTraces: any[] = [];
  if (!toEmail && objectId > 0) {
    // 1) new path
    const a = await doLookup("/api/hubspot/lookupEmail", origin, objectId);
    lookupTraces.push(a.trace);
    if (a.out.ok) {
      if (!toEmail && a.out.email) toEmail = a.out.email;
      if (!subject && a.out.subject) subject = a.out.subject;
      if (!text && a.out.text) text = a.out.text;
    } else {
      // 2) fallback for older builds
      const b = await doLookup("/api/hubspot/lookup", origin, objectId);
      lookupTraces.push(b.trace);
      if (b.out.ok) {
        if (!toEmail && b.out.email) toEmail = b.out.email;
        if (!subject && b.out.subject) subject = b.out.subject;
        if (!text && b.out.text) text = b.out.text;
      }
    }
  }

  if (!toEmail) {
    const res = {
      ok: true,
      dryRun,
      send_ok: false,
      reason: "missing_toEmail",
      lookup_traces: lookupTraces, // you’ll see exactly which paths/statuses were tried
    };
    console.log("[webhook] missing_toEmail", res);
    return NextResponse.json(res, { status: 200 });
  }

  // Prove we would send (or actually send if enabled)
  if (dryRun || !REPLY_ENABLED) {
    const res = {
      ok: true,
      dryRun,
      send_ok: true,
      send_status: 200,
      send_result: "would_send",
      to: toEmail,
      subject,
      lookup_traces: lookupTraces,
    };
    console.log("[webhook] orchestrate result", res);
    return NextResponse.json(res, { status: 200 });
  }

  // LIVE: delegate to /api/msgraph/send
  try {
    const r = await fetch(new URL("/api/msgraph/send", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        mode: "live",
        toEmail,
        subject: subject || "(no subject)",
        text: text || "(no body)",
        dryRun: false,
      }),
    });
    const t = await r.text();
    let j: any = {}; try { j = JSON.parse(t); } catch {}
    const res = {
      ok: r.ok,
      dryRun: false,
      send_ok: r.ok,
      send_status: r.status,
      send_result: j?.result ?? (r.ok ? "sent" : "error"),
      to: toEmail,
      subject,
    };
    console.log("[webhook] orchestrate result", res);
    return NextResponse.json(res, { status: 200 });
  } catch (err: any) {
    const res = { ok: false, dryRun: false, send_ok: false, reason: "msgraph_exception", detail: err?.message ?? String(err) };
    console.log("[webhook] orchestrate exception", res);
    return NextResponse.json(res, { status: 200 });
  }
}
