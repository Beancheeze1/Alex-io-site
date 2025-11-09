// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* utils */
function envBool(name: string, d = false) {
  const v = process.env[name]?.trim().toLowerCase();
  return v ? v === "1" || v === "true" || v === "yes" : d;
}
function baseUrl(req: NextRequest) {
  const e = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (e) return e;
  const u = new URL(req.url);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}

/* hubspot payload: can be array */
type HS = { subscriptionType?: string; objectId?: number | string; messageId?: string; [k: string]: any };
const asEvents = (x: any): HS[] => (Array.isArray(x) ? x : x ? [x] : []);
const pickEvent = (evs: HS[]) =>
  evs.find(e => String(e.subscriptionType ?? "").includes("conversation.newMessage")) ??
  evs.find(e => Number(e.objectId ?? 0) > 0) ??
  evs[0] ?? null;

async function lookupWithRetry(
  url: string,
  body: any,
  tries = 8,
  firstDelay = 0,
  step = 800
) {
  const traces: any[] = [];
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, firstDelay + step * (i - 1)));
    const r = await fetch(`${url}/api/hubspot/lookupEmail?t=${Math.random()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    let j: any = null, jsonOk = false;
    try { j = await r.json(); jsonOk = true; } catch {}
    const got = jsonOk && typeof j?.email === "string" && j.email.length > 0;
    traces.push({
      attempt: i + 1,
      path: "/api/hubspot/lookupEmail",
      url: `${url}/api/hubspot/lookupEmail`,
      httpOk: r.ok,
      status: r.status,
      jsonOk,
      gotEmail: got,
      keys: jsonOk ? Object.keys(j) : [],
      src: j?.src,
    });
    if (jsonOk && j?.ok && got) return { ok: true, j, traces };
  }
  return { ok: false, j: null as any, traces };
}

export async function POST(req: NextRequest) {
  const replyEnabled = envBool("REPLY_ENABLED", true); // keep true if you’re actively testing
  const dryRun = /^(1|true|yes)$/i.test(req.nextUrl.searchParams.get("dryRun") ?? "");
  console.log("////////////////////////////////////////////////////////");

  let raw: any = null;
  try { raw = await req.json(); } catch {}
  const events = asEvents(raw);
  const ev = pickEvent(events);

  const sub = String(ev?.subscriptionType ?? "undefined");
  const objectId = Number(ev?.objectId ?? 0);
  const messageId = String(ev?.messageId ?? "");

  console.log("[webhook] received {",
    `subscriptionType: '${sub}',`,
    `objectId: ${objectId},`,
    `messageId: '${messageId}'`,
  "}");

  if (!replyEnabled) {
    return NextResponse.json({ ok: true, dryRun: true, send_ok: false, reason: "reply_disabled" }, { status: 200 });
  }
  if (!objectId) {
    return NextResponse.json(
      { ok: true, dryRun, send_ok: false, reason: "missing_objectId_or_bad_payload", batchSize: events.length },
      { status: 200 }
    );
  }

  const BASE = baseUrl(req);

  // NEW: pass both thread + message
  const { ok, j, traces } = await lookupWithRetry(BASE, { objectId, messageId }, 8, 0, 800);
  if (!ok || !j?.email) {
    console.log("[webhook] missing_toEmail", { ok: true, dryRun, send_ok: false, toEmail: "", lookup_traces: traces });
    return NextResponse.json(
      { ok: true, dryRun, send_ok: false, toEmail: "", reason: "missing_toEmail", lookup_traces: traces },
      { status: 200 }
    );
  }

  const toEmail = j.email;
  const subject = j.subject ?? "";
  const text = j.text ?? "";

  const orch = await fetch(`${BASE}/api/ai/orchestrate?t=${Math.random()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ mode: "ai", toEmail, subject, text, inReplyTo: null, dryRun }),
  });

  let o: any = {};
  try { o = await orch.json(); } catch {}

  console.log("[webhook] done { ok: true, dryRun:", dryRun, ", send_ok:", orch.ok, ", toEmail:", `'${toEmail}'`, "}");
  return NextResponse.json(
    { ok: true, dryRun, send_ok: orch.ok, toEmail, lookup_traces: traces, orchestrate_status: orch.status, orch_keys: Object.keys(o ?? {}) },
    { status: 200 }
  );
}
