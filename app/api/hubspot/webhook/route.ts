// app/api/hubspot/webhook/route.ts
// Alex-IO HubSpot Webhook → Graph Reply Handler
// - Micro-throttle to absorb quick HubSpot retries
// - Idempotency + per-thread cooldown
// - Contact-aware templating (name/company)
// - Quote token + {{quoteLink}} / {{quoteId}}
// - Per-inbox signatures (auto-appended when {{signatureHtml}} not present)
// - Optional brand wrapper (REPLY_BRAND_WRAPPER=true)
// - Text fallback (B3) passed to Graph along with HTML
// - Internal self/send URLs honor INTERNAL_* envs to avoid host drift

import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { pickTemplate } from "@/app/lib/templates";
import { renderTemplate, htmlToText } from "@/app/lib/tpl";
import { shouldWrap, wrapHtml } from "@/app/lib/layout";
import { pickSignature } from "@/app/lib/signature";

export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/* small utilities                                                             */
/* -------------------------------------------------------------------------- */

const b = (v: unknown) => String(v ?? "").toLowerCase() === "true";

const g = (o: any, p: string[]) =>
  p.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);

const isEmail = (s: unknown): s is string =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Extract a usable Message-Id from HS event if present (else null). */
function extractMessageId(evt: any): string | null {
  const headers =
    g(evt, ["message", "headers"]) ||
    g(evt, ["object", "message", "headers"]) ||
    {};
  const mid =
    headers["Message-Id"] ||
    headers["message-id"] ||
    headers["MESSAGE-ID"] ||
    evt?.messageId ||
    evt?.object?.messageId ||
    null;
  return typeof mid === "string" && mid.length > 6 ? String(mid) : null;
}

/** True if our loop header is present (ignore such events). */
function hasLoopHeader(evt: any): boolean {
  const headers =
    g(evt, ["message", "headers"]) ||
    g(evt, ["object", "message", "headers"]) ||
    {};
  return (
    String(
      headers["X-AlexIO-Responder"] ?? headers["x-alexio-responder"] ?? ""
    ).trim() === "1"
  );
}

/** Treat HS “new inbound” message types as replyable. */
function isNewInbound(evt: any): boolean {
  const subscriptionType = String(evt?.subscriptionType ?? "");
  const changeFlag = String(evt?.changeFlag ?? "");
  const messageType = String(evt?.messageType ?? "");
  return (
    subscriptionType.includes("conversation.newMessage") ||
    changeFlag === "NEW_MESSAGE" ||
    messageType === "MESSAGE"
  );
}

/** Minimal JSON POST helper (no-store). */
async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/* -------------------------------------------------------------------------- */
/* route                                                                       */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const startedAt = Date.now();
    const url = new URL(req.url);

    // Query controls
    const dryRun = url.searchParams.get("dryRun") === "1";
    const replyEnabled = b(process.env.REPLY_ENABLED);

    // Internal URLs (lock to API origin if provided)
    const SELF =
      process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;
    const SEND =
      process.env.INTERNAL_SEND_URL ||
      new URL("/api/msgraph/send", url).toString();

    // Quote link base + token TTL
    const QUOTE_LINK_BASE =
      process.env.QUOTE_LINK_BASE || `${url.protocol}//${url.host}/q`;
    const QUOTE_TTL_DAYS = Math.max(
      1,
      Number(process.env.QUOTE_TTL_DAYS ?? 30)
    );

    // Throttles / TTLs
    const kv = makeKv();
    const cooldownMin = Number(process.env.REPLY_COOLDOWN_MIN ?? 120); // after a send per thread
    const idemTtlMin = Number(process.env.IDEMP_TTL_MIN ?? 1440); // Message-Id idempotency minutes
    const microThrottleSec = Math.max(
      1,
      Number(process.env.REPLY_MICRO_THROTTLE_SEC ?? 5)
    ); // absorb quick HS retries

    // Payload → pick first event (HS batches)
    const events = (await req.json()) as any[];
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "no_events",
      });
    }
    const evt = events[0];

    const objectId = evt?.objectId ?? evt?.threadId ?? null;
    const rawMessageId = extractMessageId(evt);

    // Type/loop guards
    if (!isNewInbound(evt)) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "wrong_subtype",
      });
    }
    if (hasLoopHeader(evt)) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "loop_header_present",
      });
    }

    // Micro-throttle (few seconds per thread+message)
    const microKey = `alexio:micro:${objectId ?? "x"}:${rawMessageId ?? "x"}`;
    if (await kv.get(microKey)) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "micro_throttle",
      });
    }
    await kv.set(microKey, "1", microThrottleSec);

    // Idempotency by Message-Id
    if (rawMessageId) {
      const idemKey = `alexio:idempotency:${rawMessageId}`;
      if (await kv.get(idemKey)) {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "idempotent",
        });
      }
    }

    // Per-thread cooldown after we send a reply
    if (objectId) {
      const cdKey = `alexio:cooldown:thread:${objectId}`;
      if (await kv.get(cdKey)) {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "cooldown",
        });
      }
    }

    /* ------------------------ email resolution & vars ----------------------- */

    // Try sender email directly from event
    let toEmail: string | null =
      g(evt, ["message", "from", "email"]) ||
      g(evt, ["object", "message", "from", "email"]) ||
      null;
    if (toEmail && !isEmail(toEmail)) toEmail = null;

    let via = "direct";
    let inboxId: string | number | null = null;
    let channelId: string | number | null = null;
    let inboxEmail: string | null = null;

    // Vars exposed to templates
    const vars: Record<string, string> = {
      firstName: "",
      lastName: "",
      name: "",
      company: "",
      displayName: "",
      quoteLink: "",
      quoteId: "",
      signatureHtml: "",
    };

    // If we don’t have email, use our lookup endpoint (pulls contact details too)
    if (!toEmail) {
      if (!objectId) {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "no_email_no_objectId",
        });
      }
      const lookupRes = await postJson(`${SELF}/api/hubspot/lookup`, {
        objectId,
        messageId: evt?.messageId ?? null,
      });
      const lookup = await lookupRes.json().catch(() => ({}));

      if (!lookupRes.ok || !lookup?.email) {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "no_email_lookup_failed",
          lookup,
        });
      }
      toEmail = lookup.email;
      via = `lookup:${lookup?.via || "unknown"}`;
      inboxId = lookup?.inboxId ?? null;
      channelId = lookup?.channelId ?? null;
      inboxEmail = lookup?.inboxEmail ?? null;

      const c = (lookup?.contact as any) || {};
      vars.firstName = String(c.firstName || "").trim();
      vars.lastName = String(c.lastName || "").trim();
      vars.name = [vars.firstName, vars.lastName].filter(Boolean).join(" ");
      vars.company = String(c.company || "").trim();
      vars.displayName = String(c.displayName || "").trim();
    }

    /* --------------------------- quote token/link --------------------------- */

    const quoteId =
      (globalThis as any).crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    const quoteKey = `alexio:quote:${quoteId}`;
    const quoteValue = JSON.stringify({
      objectId,
      messageId: rawMessageId,
      toEmail,
      inboxEmail,
      createdAt: Date.now(),
    });
    await kv.set(quoteKey, quoteValue, QUOTE_TTL_DAYS * 24 * 60 * 60);
    const quoteLink = `${QUOTE_LINK_BASE}?t=${encodeURIComponent(quoteId)}`;
    vars.quoteId = quoteId;
    vars.quoteLink = quoteLink;

    /* ----------------------- template + signature render -------------------- */

    // Choose template by inbox/channel/default
    const tpl = pickTemplate({
      inboxEmail: inboxEmail ?? undefined,
      inboxId: inboxId ?? undefined,
      channelId: channelId ?? undefined,
    });

    const subjectRaw = tpl.subject;
    const innerHtmlRaw =
      tpl.html ||
      `<p>Thanks for reaching out to Alex-IO. We received your message and will follow up shortly.</p><p>— Alex-IO</p>`;

    // Per-inbox signature (env SIGNATURES_JSON) and provide {{signatureHtml}}
    const sig = pickSignature({ inboxEmail, inboxId, channelId });
    vars.signatureHtml = sig.html;

    // Render subject + inner HTML with vars
    const subject =
      renderTemplate(subjectRaw, vars) ||
      subjectRaw ||
      "Thanks for your message";
    let innerHtml = renderTemplate(innerHtmlRaw, vars) || innerHtmlRaw;

    // If the template didn’t explicitly include {{signatureHtml}}, auto-append
    if (!/\{\{\s*signatureHtml\s*\}\}/.test(innerHtml)) {
      innerHtml = `${innerHtml}
        <div style="margin-top:16px; border-top:1px solid #e5e7eb; padding-top:12px;">
          ${sig.html}
        </div>`;
    }

    // Optional brand wrapper; plain-text fallback from inner content
    const html = shouldWrap() ? wrapHtml(innerHtml) : innerHtml;
    const text = htmlToText(innerHtml);

    /* -------------------------- dry-run or live send ------------------------ */

    if (dryRun || !replyEnabled) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        wouldSend: true,
        toEmail,
        via,
        quoteId,
        quoteLink,
        wrapped: shouldWrap(),
        template: {
          subject,
          htmlPreview: html.slice(0, 180),
          textPreview: text.slice(0, 180),
        },
      });
    }

    // Send through internal Graph route (adds loop header; no refs)
    const sendRes = await postJson(SEND, {
      to: toEmail,
      subject,
      html,
      text,
    });
    if (!sendRes.ok) {
      const t = await sendRes.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: "graph send failed",
          status: sendRes.status,
          details: t.slice(0, 1000),
        },
        { status: 502 }
      );
    }

    // Mark idempotency & per-thread cooldown after successful send
    if (rawMessageId) {
      await kv.set(
        `alexio:idempotency:${rawMessageId}`,
        "1",
        Math.max(60, idemTtlMin * 60)
      );
    }
    if (objectId) {
      await kv.set(
        `alexio:cooldown:thread:${objectId}`,
        "1",
        Math.max(60, cooldownMin * 60)
      );
    }

    console.log(
      "[webhook] SENT to=%s via=%s wrapped=%s ms=%d",
      toEmail,
      via,
      shouldWrap(),
      Date.now() - startedAt
    );

    return NextResponse.json({
      ok: true,
      sent: true,
      toEmail,
      via,
      quoteId,
      quoteLink,
      wrapped: shouldWrap(),
      templateUsed: { subject },
    });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
