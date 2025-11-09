// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

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
  threadId?: number;
  src?: any;
};

type HubSpotEvent = {
  subscriptionType?: string;
  objectId?: number;
  threadId?: number; // some hubs send this as threadId
  messageId?: string;
  messageType?: string;
  changeFlag?: string;
};

const BASE = "https://api.alex-io.com"; // per project rule

const REPLY_ENABLED = String(process.env.REPLY_ENABLED ?? "").toLowerCase() === "true";

async function doLookup(objectId: number): Promise<{ ok: boolean; out?: LookupOut; trace: any }> {
  const body = JSON.stringify({ objectId });
  const url = `${BASE}/api/hubspot/lookupEmail?t=${Math.random()}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body,
  });
  let out: LookupOut | undefined = undefined;
  try { out = (await r.json()) as LookupOut; } catch {}
  return { ok: r.ok && !!out?.ok, out, trace: { path: "/api/hubspot/lookupEmail", url, ok: r.ok, status: r.status } };
}

async function callOrchestrate(args: {
  toEmail: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  dryRun: boolean;
}) {
  const url = `${BASE}/api/ai/orchestrate?t=${Math.random()}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ mode: "ai", ...args }),
  });
  const txt = await r.text();
  let json: any = undefined;
  try { json = JSON.parse(txt); } catch {}
  return { ok: r.ok, status: r.status, body: json ?? txt, url };
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const ev = (await req.json().catch(() => ({}))) as HubSpotEvent;

    // quick guardrails
    if (!REPLY_ENABLED) {
      const res = {
        ok: true,
        dryRun: true,
        replyEnabled: false,
        reason: "reply_disabled",
      };
      console.log("[orchestrate] DRYRUN or REPLY_DISABLED", res);
      return NextResponse.json(res, { status: 200 });
    }

    const objectId = Number(ev.objectId ?? 0);
    console.log("//////////////////////////////////////////////////////");
    console.log("[webhook] received {",
      `subscriptionType: '${ev.subscriptionType}',`,
      `objectId: ${objectId} }`
    );

    // 1) Look up customer email/subject/text for this thread
    const lookup = await doLookup(objectId);
    const traces: any[] = [lookup.trace];

    if (!lookup.ok || !lookup.out?.ok) {
      const res = {
        ok: true,
        dryRun: false,
        send_ok: false,
        toEmail: "",
        reason: "missing_toEmail",
        lookup_traces: traces,
      };
      console.log("[webhook] missing_toEmail", res);
      return NextResponse.json(res, { status: 200 });
    }

    const toEmail = String(lookup.out.email ?? "").trim();
    const subject = String(lookup.out.subject ?? "").trim();
    const text = String(lookup.out.text ?? "").trim();

    if (!toEmail) {
      const res = {
        ok: true,
        dryRun: false,
        send_ok: false,
        toEmail: "",
        reason: "missing_toEmail",
        lookup_traces: traces,
      };
      console.log("[webhook] missing_toEmail", res);
      return NextResponse.json(res, { status: 200 });
    }

    // 2) Orchestrate AI -> msgraph/send (no placeholders!)
    const orch = await callOrchestrate({
      toEmail,
      subject,
      text,
      inReplyTo: ev.messageId ?? undefined,
      dryRun: false,
    });
    traces.push({ path: "/api/ai/orchestrate", url: orch.url, ok: orch.ok, status: orch.status });

    const ms = Date.now() - t0;
    console.log("[webhook] done {",
      `ok: ${orch.ok},`,
      `dryRun: false,`,
      `send_ok: ${orch.ok},`,
      `toEmail: '${toEmail}',`,
      `ms: ${ms},`,
      `lookup_traces:`, traces, "}"
    );

    return NextResponse.json(
      {
        ok: true,
        dryRun: false,
        send_ok: orch.ok,
        toEmail,
        ms,
        body: orch.body,
        lookup_traces: traces,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[webhook] exception", err?.message ?? err);
    return NextResponse.json({ ok: false, error: "webhook_exception", detail: err?.message ?? String(err) }, { status: 200 });
  }
}
