// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** ---------- helpers ---------- */
function env(name: string, required = false) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v ?? "";
}

function getBoolean(v: string | null | undefined) {
  if (!v) return false;
  return /^(1|true|yes|on)$/i.test(v);
}

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body ?? {}),
  });
}

/** Use Headers.get() for a single header (case-insensitive by spec) */
function getHeader(h: Headers, name: string): string | undefined {
  const v = h.get(name);
  return v === null ? undefined : v;
}

/** Iterate headers using forEach (works across TS lib variants) */
function pickHeaders(h: Headers, allow: (k: string) => boolean) {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    if (allow(key.toLowerCase())) out[key] = value;
  });
  return out;
}

/** Try to grab a Message-ID out of a headers object if HubSpot passed one inline */
function extractInlineMessageId(headers: any): string | undefined {
  if (!headers) return undefined;

  const read = (k: string) => {
    const v =
      headers?.[k] ??
      headers?.[k.toLowerCase()] ??
      headers?.[k.toUpperCase()];
    return typeof v === "string" ? v : undefined;
  };

  const direct =
    read("Message-Id") ||
    read("Message-ID") ||
    read("Internet-Message-ID") ||
    read("Internet-Message-Id");

  if (!direct) return undefined;
  const s = direct.trim();
  return s.startsWith("<") ? s : `<${s}>`;
}

/** ---------- handler ---------- */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const SELF = env("NEXT_PUBLIC_BASE_URL", true); // e.g. https://api.alex-io.com
  const replyEnabled = getBoolean(env("REPLY_ENABLED") || env("ALEX_REPLY_ENABLED"));
  const skipLookup = getBoolean(env("HUBSPOT_SKIP_LOOKUP"));
  const dryRunParam = url.searchParams.get("dryRun") === "1";

  try {
    // Log useful request envelope (lightweight)
    const hdrDump = pickHeaders(req.headers, (k) =>
      k === "content-type" || k === "user-agent" || k.startsWith("x-hubspot")
    );
    console.log("[webhook] -> entry", {
      method: req.method,
      path: url.pathname,
      headers: hdrDump,
    });

    // HubSpot sends an array of change objects
    const arr = (await req.json()) as any[];
    if (!Array.isArray(arr) || arr.length === 0) {
      console.log("[webhook] exit { reason: 'empty_payload' }");
      return NextResponse.json({ ok: true, ignored: true, reason: "empty_payload" });
    }

    // Prefer a NEW_MESSAGE event
    const evt =
      arr.find((x) => String(x?.changeFlag || "").toUpperCase() === "NEW_MESSAGE") ||
      arr[0];

    const subscriptionType = String(evt?.subscriptionType || "");
    const changeFlag = String(evt?.changeFlag || "");
    const eventId = evt?.eventId ?? evt?.eventID ?? evt?.id ?? null;

    // Thread / object id (HubSpot "threadId")
    const objectId = evt?.objectId ?? evt?.objectID ?? evt?.threadId ?? null;

    // Inline message payload HubSpot sometimes includes
    const message = evt?.message || {};
    const fromEmail =
      message?.from?.email ||
      message?.sender?.email ||
      message?.originator?.email ||
      "";
    const subjectInline = message?.subject || "";
    const textInline = message?.text || "";
    const headersInline = message?.headers || message?.emailHeaders || message?.metadata?.headers || {};
    const inlineMessageId = extractInlineMessageId(headersInline);

    if (!objectId) {
      console.log("[webhook] exit { reason: 'no_objectId_in_event', ms:", Date.now() - t0, "}");
      return NextResponse.json({ ok: true, ignored: true, reason: "no_objectId_in_event" });
    }

    // Compose initial values; we'll hydrate as needed
    let toEmail: string | undefined = fromEmail || undefined;
    let subject: string | undefined = subjectInline || undefined;
    let text: string | undefined = textInline || undefined;
    let inReplyTo: string | undefined = inlineMessageId || undefined;

    // If anything critical is missing (or we need the true Internet Message-ID), call lookup
    if (!skipLookup && (!toEmail || !subject || !text || !inReplyTo)) {
      try {
        const res = await postJson(`${SELF}/api/hubspot/lookup`, {
          objectId,
          // Some tenants include a numeric HubSpot message id in evt.message.id; pass it if present
          messageId: message?.id ?? null,
        });
        const j = await res.json().catch(() => ({} as any));

        // Fill blanks from lookup
        toEmail = toEmail || j?.email || undefined;
        subject = subject || j?.subject || undefined;
        // Only override text if we truly have nothing
        text = text || undefined;

        // Most important bit for threading:
        if (j?.internetMessageId) {
          inReplyTo = j.internetMessageId;
        }

        console.log("[webhook] lookup_ok", {
          email: toEmail,
          subject,
          haveMID: !!inReplyTo,
        });
      } catch (e: any) {
        console.warn("[webhook] lookup_failed", e?.message || String(e));
      }
    } else {
      console.log("[webhook] lookup_skipped", {
        SKIP_LOOKUP: skipLookup,
        HAS_TOKEN: !!process.env.HUBSPOT_ACCESS_TOKEN,
      });
    }

    if (!toEmail) {
      console.log("[webhook] exit { reason: 'no_email_after_lookup', extra: { objectId } }");
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "no_email_after_lookup",
        extra: { objectId },
      });
    }

    // Build orchestrate request
    const orchestrateBody = {
      toEmail,
      subject: subject || "Re: your message",
      text: text || "", // ok if empty; parser + memory can fill
      inReplyTo: inReplyTo || undefined, // <- TRUE Internet Message-ID when available
      dryRun: dryRunParam || !replyEnabled, // force dryRun if replies disabled
      hubspot: { objectId },
      ai: { task: "foam_quote", hints: [] },
    };

    // Send to orchestrator
    const sendRes = await postJson(`${SELF}/api/ai/orchestrate`, orchestrateBody);
    const sendJson = await sendRes.json().catch(() => ({} as any));

    console.log("[webhook] AI ok", {
      to: toEmail,
      status: sendJson?.status ?? sendRes.status,
      ms: Date.now() - t0,
    });

    return NextResponse.json({
      ok: true,
      event: { subscriptionType, changeFlag, eventId, objectId },
      orchestrate: sendJson,
    });
  } catch (e: any) {
    console.error("[webhook] ERROR", e?.message || String(e));
    return NextResponse.json(
      { ok: false, error: e?.message || "webhook_exception" },
      { status: 500 }
    );
  }
}
