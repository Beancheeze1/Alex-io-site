// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Safe stringify for logs */
function j(x: any) { try { return JSON.stringify(x); } catch { return String(x); } }
async function readBody(req: Request) { try { return await req.json(); } catch { return null; } }
function getHeader(h: Headers, name: string) { return h.get(name) ?? h.get(name.toLowerCase()) ?? null; }

const log = {
  info: (...a: any[]) => console.log(...a),
  warn: (...a: any[]) => console.warn(...a),
  error: (...a: any[]) => console.error(...a),
};

export async function POST(req: Request) {
  const t0 = Date.now();
  const method = req.method;
  const url = new URL(req.url);

  log.info("[webhook] -> entry {");
  log.info("  method:", method + ",");
  log.info("  path:", j(url.pathname) + ",");
  log.info("  headers: {");
  for (const k of [
    "content-type","content-length",
    "x-hubspot-signature","x-hubspot-signature-v3","x-hubspot-request-timestamp",
    "x-forwarded-host","x-forwarded-proto"
  ]) {
    const v = req.headers.get(k); if (v) log.info(`  '${k}': '${v}',`);
  }
  log.info("  }");
  log.info("}");

  const SELF = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  // Accept either flag name (old/new)
  const REPLY_ENABLED =
    (process.env.ALEXIO_REPLY_ENABLED ?? process.env.REPLY_ENABLED ?? "false").toLowerCase() === "true";
  const SKIP_LOOKUP = (process.env.HUBSPOT_SKIP_LOOKUP ?? "0") === "1";

  const HAS_CREDENTIALS =
    !!process.env.HUBSPOT_ACCESS_TOKEN ||
    (!!process.env.HUBSPOT_REFRESH_TOKEN && !!process.env.HUBSPOT_CLIENT_ID && !!process.env.HUBSPOT_CLIENT_SECRET);

  const body = await readBody(req);
  if (!Array.isArray(body) || body.length === 0) {
    log.warn("[webhook] empty_or_invalid_body");
    return NextResponse.json({ ok: true, ignored: true, reason: "empty_or_invalid_body" });
  }

  // Focus on conversation.newMessage
  const evt = body.find((e: any) => (e?.subscriptionType ?? "").includes("conversation.newMessage")) ?? body[0];
  const objectId = Number(evt?.objectId ?? evt?.eventId ?? 0) || null;
  const changeFlag = (evt?.changeFlag ?? "").toString();
  const message = evt?.message ?? {};
  let subject: string = (evt?.subject ?? "").toString();
  let text: string = (evt?.text ?? "").toString();
  let toEmail: string | null = null;

  const rawMessageId =
    getHeader(req.headers, "message-id") ||
    getHeader(req.headers, "Message-Id") ||
    getHeader(req.headers, "x-message-id") ||
    null;

  // Lookup if needed
  if (!toEmail || !text || !subject) {
    if (SKIP_LOOKUP || !HAS_CREDENTIALS) {
      log.info("[webhook] exit {");
      log.info("  reason: 'lookup_skipped',");
      log.info("  extra:", j({ SKIP_LOOKUP, HAS_TOKEN: HAS_CREDENTIALS }) + ",");
      log.info("  ms:", Date.now() - t0);
      log.info("}");
      return NextResponse.json({ ok: true, ignored: true, reason: "lookup_skipped", extra: { SKIP_LOOKUP, HAS_TOKEN: HAS_CREDENTIALS } });
    }
    if (!objectId) {
      log.info("[webhook] exit { reason: 'no_objectId_for_lookup' }");
      return NextResponse.json({ ok: true, ignored: true, reason: "no_objectId_for_lookup" });
    }

    try {
      // ⬇️ Switched to the actual resolver in your codebase
      const res = await fetch(`${SELF}/api/hubspot/lookupEmail`, {
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

  if (!toEmail) {
    log.info("[webhook] exit {");
    log.info("  reason: 'no_email_lookup_failed',");
    log.info("  extra:", j({ objectId, changeFlag }) + ",");
    log.info("  ms:", Date.now() - t0);
    log.info("}");
    return NextResponse.json({ ok: true, ignored: true, reason: "no_email_lookup_failed", extra: { objectId, changeFlag } });
  }

  if (!REPLY_ENABLED) {
    log.info("[webhook] exit { reason: 'reply_disabled', to:", toEmail, "}");
    return NextResponse.json({ ok: true, ignored: true, reason: "reply_disabled", to: toEmail });
  }

  try {
    const aiRes = await fetch(`${SELF}/api/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
     body: JSON.stringify({
  mode: "ai",
  toEmail: toEmail,
  subject: subject || "(no subject)",
  text: text || "",
  // use the HubSpot conversation as the canonical thread key
  threadId: `hs:${objectId}`,
  // (optional context bucket; fine to keep empty for now)
  threadMsgs: [],
  inReplyTo: rawMessageId || undefined,
  dryRun: false, // LIVE SEND
  hubspot: { objectId },
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
