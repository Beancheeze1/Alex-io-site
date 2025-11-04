// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Safe stringify for logs */
function j(x: any) {
  try { return JSON.stringify(x); } catch { return String(x); }
}

/** Parse JSON body (HubSpot sends an array of events) */
async function readBody(req: Request) {
  try { return await req.json(); } catch { return null; }
}

/** Pull a header in a case-insensitive way */
function getHeader(headers: Headers, name: string): string | null {
  const v = headers.get(name) ?? headers.get(name.toLowerCase());
  return v ?? null;
}

/** Quick logger wrapper (Render will show console.*) */
const log = {
  info: (...args: any[]) => console.log(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
};

export async function POST(req: Request) {
  const t0 = Date.now();

  // basic request details for debugging
  const method = req.method;
  const url = new URL(req.url);
  log.info("[webhook] -> entry {");
  log.info("  method:", method + ",");
  log.info("  path:", j(url.pathname) + ",");
  log.info("  headers: {");
  // Print a small subset of headers (avoid noise)
  for (const k of [
    "content-type",
    "content-length",
    "x-hubspot-signature",
    "x-hubspot-signature-v3",
    "x-hubspot-request-timestamp",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]) {
    const v = req.headers.get(k);
    if (v) log.info(`  '${k}': '${v}',`);
  }
  log.info("  }");
  log.info("}");

  // flags
  const SELF = process.env.NEXT_PUBLIC_BASE_URL || "";
  const REPLY_ENABLED = (process.env.REPLY_ENABLED ?? "false").toLowerCase() === "true";
  const SKIP_LOOKUP = (process.env.HUBSPOT_SKIP_LOOKUP ?? "0") === "1";

  // ✅ NEW: treat either ACCESS token *or* REFRESH flow as valid credentials
  const HAS_CREDENTIALS =
    !!process.env.HUBSPOT_ACCESS_TOKEN ||
    (!!process.env.HUBSPOT_REFRESH_TOKEN &&
      !!process.env.HUBSPOT_CLIENT_ID &&
      !!process.env.HUBSPOT_CLIENT_SECRET);

  // hubspot payload (array)
  const body = await readBody(req);
  if (!Array.isArray(body) || body.length === 0) {
    log.warn("[webhook] empty_or_invalid_body");
    return NextResponse.json({ ok: true, ignored: true, reason: "empty_or_invalid_body" });
  }

  // We only care about conversation.newMessage events
  const evt = body.find((e: any) => (e?.subscriptionType ?? "").includes("conversation.newMessage")) ?? body[0];

  const objectId = Number(evt?.objectId ?? evt?.eventId ?? 0) || null;
  const changeFlag = (evt?.changeFlag ?? "").toString();
  const message = evt?.message ?? {};
  const subjectFromEvt = (evt?.subject ?? "").toString();
  const textFromEvt = (evt?.text ?? "").toString();

  // Headers that might carry a Message-Id (HubSpot won’t always include)
  const rawMessageId =
    getHeader(req.headers, "message-id") ||
    getHeader(req.headers, "Message-Id") ||
    getHeader(req.headers, "x-message-id") ||
    null;

  // Loop-protection and idempotency would normally live here (omitted for brevity)

  // Resolve email/subject/text:
  let toEmail: string | null = null;
  let subject: string = subjectFromEvt || "";
  let text: string = textFromEvt || "";

  // If we don't already have a usable email/subject/text, hydrate via lookup
  if (!toEmail || !text || !subject) {
    if (SKIP_LOOKUP || !HAS_CREDENTIALS) {
      log.info("[webhook] exit {");
      log.info("  reason: 'lookup_skipped',");
      log.info("  extra:", j({ SKIP_LOOKUP, HAS_TOKEN: HAS_CREDENTIALS }) + ",");
      log.info("  ms:", Date.now() - t0);
      log.info("}");
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "lookup_skipped",
        extra: { SKIP_LOOKUP, HAS_TOKEN: HAS_CREDENTIALS },
      });
    }

    if (!objectId) {
      log.info("[webhook] exit { reason: 'no_objectId_for_lookup' }");
      return NextResponse.json({ ok: true, ignored: true, reason: "no_objectId_for_lookup" });
    }

    // Call our own lookup route (now robust and refresh-token aware)
    try {
      const res = await fetch(`${SELF}/api/hubspot/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ objectId, messageId: rawMessageId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        log.warn("[webhook] lookup_failed", res.status, j(data).slice(0, 400));
      } else {
        toEmail = data.email || toEmail;
        subject = (data.subject ?? subject).toString();
        text = (data.text ?? text).toString();
        log.info("[webhook] lookup_ok", j({ email: toEmail, subject: subject?.slice(0, 80), threadId: data.threadId }));
      }
    } catch (e: any) {
      log.error("[webhook] lookup_exception", e?.message || String(e));
    }
  }

  // If still no recipient email, we can’t reply
  if (!toEmail) {
    log.info("[webhook] exit {");
    log.info("  reason: 'no_email_lookup_failed',");
    log.info("  extra:", j({ objectId, changeFlag }) + ",");
    log.info("  ms:", Date.now() - t0);
    log.info("}");
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "no_email_lookup_failed",
      extra: { objectId, changeFlag },
    });
  }

  // If replies disabled, bail cleanly
  if (!REPLY_ENABLED) {
    log.info("[webhook] exit { reason: 'reply_disabled', to:", toEmail, "}");
    return NextResponse.json({ ok: true, ignored: true, reason: "reply_disabled", to: toEmail });
  }

  // Orchestrate AI reply (your existing orchestrator/graph send stays unchanged)
  try {
    const aiRes = await fetch(`${SELF}/api/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        to: toEmail,
        subject: subject || "(no subject)",
        text: text || "",
        dryRun: false, // live send path
      }),
    });
    const ai = await aiRes.json().catch(() => ({}));

    log.info("[webhook] AI ok", j({ to: toEmail, status: aiRes.status, ms: Date.now() - t0 }));
    return NextResponse.json({ ok: true, to: toEmail, aiStatus: aiRes.status, ai }, { status: 200 });
  } catch (e: any) {
    log.error("[webhook] AI exception", e?.message || String(e));
    return NextResponse.json({ ok: false, error: "ai_exception", message: e?.message || String(e) });
  }
}
