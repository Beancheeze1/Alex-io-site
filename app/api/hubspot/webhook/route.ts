// app/api/hubspot/webhook/route.ts
// Now delegates response logic to the AI orchestrator.
// Keeps: idempotency, cooldown, loop guards, internal send via /api/msgraph/send

import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { htmlToText } from "@/app/lib/tpl";

export const dynamic = "force-dynamic";

type HSMessage = {
  from?: { email?: string; name?: string; firstName?: string; lastName?: string; company?: string; displayName?: string; };
  subject?: string;
  headers?: Record<string, string>;
  text?: string;
};

function nowSec() { return Math.floor(Date.now() / 1000); }
function minutes(n: number) { return n * 60; }
function toBool(v: any, fallback = false) {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? ["1","true","yes","y","on"].includes(s) : fallback;
}
function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const MAILBOX_FROM = (process.env.MS_MAILBOX_FROM || "").toLowerCase();
const REPLY_ENABLED = toBool(process.env.REPLY_ENABLED ?? "true", true);
const COOLDOWN_MIN = toInt(process.env.REPLY_COOLDOWN_MIN ?? "10", 10);

const stateKey = (c: string|number) => `alexio:thread:${c}`;
const msgKey   = (m: string) => `alexio:webhook:msg:${m}`;
const STATE_TTL = 30 * 24 * 60 * 60;
const MSG_TTL   = 14 * 24 * 60 * 60;

function parseJson<T>(raw?: string|null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

async function postJson<T>(path: string, body: any): Promise<{ ok: boolean; json?: T; status: number; }> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const url = `${base}${path}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body) });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { ok: res.ok, json, status: res.status };
}

export async function POST(req: NextRequest) {
  let debug: any = {};
  try {
    const kv = makeKv();
    const url = new URL(req.url);
    const isDry = url.searchParams.get("dryRun") === "1";

    const body = await req.json();
    const events = Array.isArray(body) ? body : [body];
    const e = events[0] || {};
    const subscriptionType = e.subscriptionType || "";
    const conversationId: string|number = e.objectId ?? e.conversationId ?? "unknown";
    const messageId = e.messageId || `${conversationId}:no-msgid:${nowSec()}`;
    const msg: HSMessage = e.message || {};
    const headers = msg.headers || {};
    const fromEmail = (msg.from?.email || "").toLowerCase();

    debug = { subscriptionType, conversationId, messageId, fromEmail };

    // Guards
    if (subscriptionType !== "conversation.newMessage") {
      return NextResponse.json({ ok: true, ignored: true, reason: "wrong_subtype", debug });
    }
    if (!fromEmail) {
      return NextResponse.json({ ok: true, ignored: true, reason: "no_sender", debug });
    }
    if (MAILBOX_FROM && fromEmail === MAILBOX_FROM) {
      return NextResponse.json({ ok: true, ignored: true, reason: "from_our_mailbox", debug });
    }
    if (headers["Auto-Submitted"] || headers["auto-submitted"]) {
      return NextResponse.json({ ok: true, ignored: true, reason: "auto_reply", debug });
    }
    if (!REPLY_ENABLED && !isDry) {
      return NextResponse.json({ ok: true, ignored: true, reason: "reply_disabled", debug });
    }

    // Idempotency
    if (await kv.get(msgKey(messageId))) {
      return NextResponse.json({ ok: true, ignored: true, reason: "idempotent", debug });
    }

    // Cooldown
    const rawState = parseJson<{ stage:number; lastSentAt:number }>(await kv.get(stateKey(conversationId))) ?? { stage:0, lastSentAt:0 };
    const now = nowSec();
    if (rawState.lastSentAt && now - rawState.lastSentAt < minutes(COOLDOWN_MIN) && !isDry) {
      return NextResponse.json({ ok: true, ignored: true, reason: "cooldown", cooldownMin: COOLDOWN_MIN, debug });
    }

    // Run orchestrator
    const incomingText = msg.text || htmlToText(e.message?.html || "") || msg.subject || "";
    const orch = await postJson<{
      ok: boolean;
      nextAction: string;
      state: any;
      message?: { subject:string; html:string; text:string; };
      pricing?: any;
    }>("/api/ai/orchestrate", {
      conversationId,
      fromEmail,
      text: incomingText,
      dryRun: isDry,
    });

    if (!orch.ok || !orch.json?.ok) {
      return NextResponse.json({ ok:false, error:"orchestrator failed", details:orch.json }, { status:502 });
    }

    const message = orch.json.message!;
    if (isDry) {
      return NextResponse.json({ ok:true, dryRun:true, nextAction: orch.json.nextAction, messagePreview: message?.text?.slice(0,280), state: orch.json.state, pricing: orch.json.pricing });
    }

    // Send via Graph
    const send = await postJson<{ ok:boolean; graph?: any }>("/api/msgraph/send", {
      to: fromEmail,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (send.ok && send.json?.ok) {
      await kv.set(msgKey(messageId), "1", MSG_TTL);
      await kv.set(stateKey(conversationId), JSON.stringify({ stage: (rawState.stage ?? 0) + 1, lastSentAt: now }), STATE_TTL);
      return NextResponse.json({ ok:true, sent:true, nextAction: orch.json.nextAction, graph: send.json?.graph || { status:202 } });
    }

    return NextResponse.json({ ok:false, error:"graph send failed", details: send.json }, { status:502 });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e?.message ?? "unknown", debug }, { status:500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "hubspot/webhook", mode: "ai-orchestrated" });
}
