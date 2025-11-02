// app/api/hubspot/webhook/route.ts
// Multi-turn responder for HubSpot Conversations: B1 → B2 → B3
// - Ignored if: Auto-Submitted, from our own mailbox, missing sender, or cooldown
// - Idempotent per messageId
// - Stage state stored per conversation (objectId) in KV
// - Sends via internal /api/msgraph/send
// - Uses your existing template system + per-inbox signatures
//
// Stage logic
//   stage 0 (first touch)  -> B1  (base template key)
//   stage 1 (second touch) -> B2  (try "<matchedKey>.b2" then "default.b2" then base)
//   stage 2+ (further)     -> B3  (try "<matchedKey>.b3" then "default.b3" then base)
//
// You can define B2/B3 variants in REPLY_TEMPLATES_JSON, e.g.:
//  "default.b2": { "subject": "Re: {{subjectPrefix}} (B2)", "html": "<p>Following up…</p>" },
//  "inbox:sales@alex-io.com.b3": { "subject": "Re: {{subjectPrefix}} (B3)", "html": "<p>Final note…</p>" }

import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { pickTemplateWithKey } from "@/app/lib/templates";
import { renderTemplate, htmlToText } from "@/app/lib/tpl";
import { shouldWrap, wrapHtml } from "@/app/lib/layout";
import { pickSignature } from "@/app/lib/signature";

export const dynamic = "force-dynamic";

// ---------- small utils

function nowSec() { return Math.floor(Date.now() / 1000); }
function minutes(n: number) { return n * 60; }

function toBool(v: any, fallback = false) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(s);
}

function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseJson<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// Internal call helper to our own API routes (Render / Cloudflare safe)
async function postJson<T>(path: string, body: any): Promise<{ ok: boolean; json?: T; status: number; }> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, json, status: res.status };
}

// ---------- env & constants

const MAILBOX_FROM = (process.env.MS_MAILBOX_FROM || "").toLowerCase();   // e.g. sales@alex-io.com
const REPLY_ENABLED = toBool(process.env.REPLY_ENABLED ?? "true", true);
const COOLDOWN_MIN = toInt(process.env.REPLY_COOLDOWN_MIN ?? "10", 10);
const STATE_TTL_SEC = 30 * 24 * 60 * 60;     // 30 days per thread
const MSG_TTL_SEC   = 14 * 24 * 60 * 60;     // 14 days per message idempotency

// ---------- template helpers (stage-aware)

type TemplateRow = { subject?: string; html?: string };
type TemplateTable = Record<string, TemplateRow>;

function getTemplates(): TemplateTable {
  return parseJson<TemplateTable>(process.env.REPLY_TEMPLATES_JSON) || {};
}

/**
 * Return a row for a given stage:
 *   stage 0: matchedKey, fallback "default", finally base
 *   stage 1: "<matchedKey>.b2" → "default.b2" → base
 *   stage 2+: "<matchedKey>.b3" → "default.b3" → base
 */
function pickStageRow(matchedKey: string, baseRow: TemplateRow, stage: number): { row: TemplateRow, key: string } {
  const table = getTemplates();

  const wantKey =
    stage <= 0 ? matchedKey
    : stage === 1 ? `${matchedKey}.b2`
    : `${matchedKey}.b3`;

  if (table[wantKey]) return { row: table[wantKey], key: wantKey };

  const defaultKey =
    stage <= 0 ? "default"
    : stage === 1 ? "default.b2"
    : "default.b3";

  if (table[defaultKey]) return { row: table[defaultKey], key: defaultKey };

  return { row: baseRow, key: matchedKey }; // fallback to base
}

// ---------- state in KV

type ThreadState = { stage: number; lastSentAt: number };
const stateKey = (conversationId: string | number) => `alexio:thread:${conversationId}`;
const msgKey   = (messageId: string) => `alexio:webhook:msg:${messageId}`;

async function readState(kv: ReturnType<typeof makeKv>, conversationId: string | number): Promise<ThreadState> {
  const raw = await kv.get(stateKey(conversationId));
  const obj = parseJson<ThreadState>(raw);
  if (obj && typeof obj.stage === "number" && typeof obj.lastSentAt === "number") return obj;
  return { stage: 0, lastSentAt: 0 };
}

async function writeState(kv: ReturnType<typeof makeKv>, conversationId: string | number, s: ThreadState) {
  await kv.set(stateKey(conversationId), JSON.stringify(s), STATE_TTL_SEC);
}

async function isProcessed(kv: ReturnType<typeof makeKv>, id: string) {
  return Boolean(await kv.get(msgKey(id)));
}

async function markProcessed(kv: ReturnType<typeof makeKv>, id: string) {
  await kv.set(msgKey(id), "1", MSG_TTL_SEC);
}

// ---------- core handler

export async function POST(req: NextRequest) {
  let debug: any = {};
  try {
    const kv = makeKv();
    const url = new URL(req.url);
    const isDry = url.searchParams.get("dryRun") === "1";

    const body = await req.json();
    const events = Array.isArray(body) ? body : [body];

    // HubSpot event schema we care about
    const e = events[0] || {};
    const subscriptionType = e.subscriptionType || "";
    const conversationId: string | number = e.objectId ?? e.conversationId ?? "unknown";
    const messageId = e.messageId || `${conversationId}:no-msgid:${nowSec()}`;
    const msg = e.message || {};
    const headers = (msg.headers || {}) as Record<string, string>;
    const fromEmail = (msg.from?.email || "").toLowerCase();

    debug = {
      subscriptionType,
      conversationId,
      messageId,
      fromEmail,
      hasHeaders: !!msg.headers,
    };

    // 0) Basic guards
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

    // 1) Idempotency per messageId
    if (await isProcessed(kv, messageId)) {
      return NextResponse.json({ ok: true, ignored: true, reason: "idempotent", debug });
    }

    // 2) Thread state + cooldown
    const state = await readState(kv, conversationId);
    const now = nowSec();
    const cooldownSec = minutes(COOLDOWN_MIN);

    if (state.lastSentAt && now - state.lastSentAt < cooldownSec && !isDry) {
      return NextResponse.json({ ok: true, ignored: true, reason: "cooldown", cooldownMin: COOLDOWN_MIN, stage: state.stage, debug });
    }

    // 3) Lookup deep info (to get inReplyTo, and confirm recipient email)
    //    We call your internal /api/hubspot/lookup route with the event.
    const lookupRes = await postJson<{ ok: boolean; email?: string; inReplyTo?: string; via?: string; }>(
      "/api/hubspot/lookup",
      { subscriptionType, objectId: conversationId, messageId, message: msg }
    );
    const recipientEmail = String(lookupRes.json?.email || fromEmail);
    const inReplyTo = String(lookupRes.json?.inReplyTo || "");

    // 4) Pick template (match by inboxEmail/inboxId/channelId/default)
    //    We assume this webhook is for your primary sales inbox.
    const inboxEmail = MAILBOX_FROM || "sales@alex-io.com";
    const picked = pickTemplateWithKey({ inboxEmail });

    // stage-aware row selection
    const stageRow = pickStageRow(picked.key, picked.template, state.stage);

    // 5) Signature + render
    const sig = pickSignature({ inboxEmail });
    const vars = {
      firstName: msg.from?.firstName || "",
      lastName: msg.from?.lastName || "",
      name: msg.from?.name || "",
      company: msg.from?.company || "",
      displayName: msg.from?.displayName || "",
      subjectPrefix: msg.subject || "",
      quoteLink: "",
      quoteId: "",
      signatureHtml: sig.html,
    };

    // subject
    const subject = renderTemplate(stageRow.row.subject || picked.template.subject || "", vars) || "(no subject)";

    // inner HTML and auto-append signature if templ did not include it
    const baseInner = renderTemplate(stageRow.row.html || picked.template.html || "", vars) || "";
    const needsAppend = !/\{\{\s*signatureHtml\s*\}\}/.test(baseInner);
    const innerHtml = needsAppend
      ? `${baseInner}
         <div style="margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px;">${sig.html}</div>`
      : baseInner;

    const wrapped = shouldWrap();
    const html = wrapped ? wrapHtml(innerHtml) : innerHtml;
    const text = htmlToText(innerHtml);

    const sendPayload = {
      to: recipientEmail,
      subject,
      html,
      text,
      inReplyTo: inReplyTo || undefined,
    };

    // 6) DryRun support
    if (isDry) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        stage: state.stage,
        matchedKey: picked.key,
        usedKey: stageRow.key,
        toEmail: recipientEmail,
        via: lookupRes.json?.via || "base",
        subject,
        htmlPreview: html.slice(0, 280),
        textPreview: text.slice(0, 280),
      });
    }

    // 7) Send via internal Graph route
    const sent = await postJson<{ ok: boolean; graph?: { status?: number; requestId?: string; }; }>(
      "/api/msgraph/send",
      sendPayload
    );

    // mark idempotent and advance stage on success
    if (sent.ok && sent.json?.ok) {
      await markProcessed(kv, messageId);
      const nextStage = Math.min(state.stage + 1, 2); // 0->1->2 (2 is B3 cap)
      await writeState(kv, conversationId, { stage: nextStage, lastSentAt: now });

      return NextResponse.json({
        ok: true,
        stageBefore: state.stage,
        stageAfter: nextStage,
        to: recipientEmail,
        matchedKey: picked.key,
        usedKey: stageRow.key,
        graph: sent.json?.graph || { status: 202 },
      });
    }

    // failed send
    return NextResponse.json(
      {
        ok: false,
        error: "graph send failed",
        status: sent.status,
        details: JSON.stringify(sent.json || {}),
      },
      { status: 502 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown", debug }, { status: 500 });
  }
}

// Optional: allow HubSpot "Test URL" (GET) to return OK
export async function GET() {
  return NextResponse.json({ ok: true, route: "hubspot/webhook", mode: "multi-turn" });
}
