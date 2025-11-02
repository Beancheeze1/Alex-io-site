// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { pickTemplate } from "@/app/lib/templates";
import { renderTemplate } from "@/app/lib/tpl";

export const dynamic = "force-dynamic";

/* -------------------- small utils -------------------- */
const b = (v: unknown) => String(v ?? "").toLowerCase() === "true";
const g = (o: any, p: string[]) =>
  p.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);
const isEmail = (s: unknown): s is string =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

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
async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/* -------------------- route -------------------- */
export async function POST(req: NextRequest) {
  try {
    const startedAt = Date.now();
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const replyEnabled = b(process.env.REPLY_ENABLED);

    // Internal URLs
    const SELF = process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;
    const SEND =
      process.env.INTERNAL_SEND_URL ||
      new URL("/api/msgraph/send", url).toString();

    // Throttles / TTLs
    const kv = makeKv();
    const cooldownMin = Number(process.env.REPLY_COOLDOWN_MIN ?? 120);
    const idemTtlMin = Number(process.env.IDEMP_TTL_MIN ?? 1440);
    const microThrottleSec = Math.max(
      1,
      Number(process.env.REPLY_MICRO_THROTTLE_SEC ?? 5)
    ); // NEW

    // Payload
    const events = (await req.json()) as any[];
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });
    }
    const evt = events[0];
    const objectId = evt?.objectId ?? evt?.threadId ?? null;
    const rawMessageId = extractMessageId(evt);

    // Basic checks
    if (!isNewInbound(evt)) {
      return NextResponse.json({ ok: true, ignored: true, reason: "wrong_subtype" });
    }
    if (hasLoopHeader(evt)) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "loop_header_present",
      });
    }

    // ---- MICRO-THROTTLE (NEW) ----
    const microKey = `alexio:micro:${objectId ?? "x"}:${rawMessageId ?? "x"}`;
    if (await kv.get(microKey)) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "micro_throttle",
      });
    }
    await kv.set(microKey, "1", microThrottleSec); // seconds

    // Idempotency / cooldown (existing logic)
    if (rawMessageId) {
      const k = `alexio:idempotency:${rawMessageId}`;
      if (await kv.get(k)) {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "idempotent",
        });
      }
    }
    if (objectId) {
      const k = `alexio:cooldown:thread:${objectId}`;
      if (await kv.get(k)) {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "cooldown",
        });
      }
    }

    // Try to extract sender email directly
    let toEmail: string | null =
      g(evt, ["message", "from", "email"]) ||
      g(evt, ["object", "message", "from", "email"]) ||
      null;
    if (toEmail && !isEmail(toEmail)) toEmail = null;

    let via = "direct";
    let inboxId: string | number | null = null;
    let channelId: string | number | null = null;
    let inboxEmail: string | null = null;
    let vars: Record<string, string> = {}; // for {{firstName}} etc

    // If not found, call our lookup to resolve email + contact vars
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

      const c = lookup?.contact || {};
      vars.firstName = (c.firstName || "").trim();
      vars.lastName = (c.lastName || "").trim();
      vars.name = [vars.firstName, vars.lastName].filter(Boolean).join(" ");
      vars.company = (c.company || "").trim();
      vars.displayName = (c.displayName || "").trim();
    }

    // Pick template and render with vars
    const tpl = pickTemplate({
      inboxEmail: inboxEmail ?? undefined,
      inboxId: inboxId ?? undefined,
      channelId: channelId ?? undefined,
    });

    const subjectRaw = tpl.subject;
    const htmlRaw =
      tpl.html ||
      `<p>Thanks for reaching out to Alex-IO. We received your message and will follow up shortly.</p><p>— Alex-IO</p>`;

    const subject =
      renderTemplate(subjectRaw, vars) ||
      subjectRaw ||
      "Thanks for your message";
    const html = renderTemplate(htmlRaw, vars) || htmlRaw;

    // Dry run / disabled replies
    if (dryRun || !replyEnabled) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        wouldSend: true,
        toEmail,
        via,
        template: { subject, htmlPreview: html.slice(0, 140) },
      });
    }

    // Send via internal msgraph route (msgraph adds loop header; no In-Reply-To/References)
    const sendRes = await postJson(SEND, { to: toEmail, subject, html });
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

    // Mark idempotent & cooldown
    if (rawMessageId)
      await kv.set(
        `alexio:idempotency:${rawMessageId}`,
        "1",
        Math.max(60, idemTtlMin * 60)
      );
    if (objectId)
      await kv.set(
        `alexio:cooldown:thread:${objectId}`,
        "1",
        Math.max(60, cooldownMin * 60)
      );

    console.log(
      "[webhook] SENT to=%s via=%s ms=%d",
      toEmail,
      via,
      Date.now() - startedAt
    );
    return NextResponse.json({
      ok: true,
      sent: true,
      toEmail,
      via,
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
