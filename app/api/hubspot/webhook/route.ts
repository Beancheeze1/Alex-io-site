// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot Webhook (conversation.newMessage)
 * - Accepts array or object payloads (HubSpot fires both styles)
 * - Extracts { toEmail, text, subject, messageId } when present
 * - If missing -> deep lookup via /api/hubspot/lookup
 * - ?dryRun=1 returns a stub 200 (keeps HubSpot green)
 * - Otherwise forwards to /api/ai/orchestrate for an AI reply
 */

// ---- small helpers ---------------------------------------------------------

function safeJson<T = any>(x: unknown): T | null {
  try {
    return x as T;
  } catch {
    return null;
  }
}

function pickFirst<T>(...vals: Array<T | undefined | null>): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null) return v as T;
  return undefined;
}

type HSArrive = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string | null;
  message?: {
    messageId?: string;
    text?: string;
    subject?: string;
    from?: { email?: string };
  };
  from?: { email?: string };
  text?: string;
  subject?: string;
  // HubSpot sometimes sticks arbitrary fields on the root:
  [k: string]: any;
};

// Best-effort normalizer: supports single-object or array payloads.
function normalizePayload(body: any): { arrive: HSArrive; raw: any } {
  if (Array.isArray(body) && body.length > 0) {
    // HubSpot batches are arrays of events; we only need the first newMessage
    const first = body[0] ?? {};
    return { arrive: first as HSArrive, raw: body };
  }
  return { arrive: body as HSArrive, raw: body };
}

// ---- main handler ----------------------------------------------------------

export async function POST(req: NextRequest) {
  const isDry = req.nextUrl.searchParams.get("dryRun") === "1";

  // HubSpot sometimes sends no content-type JSON hints; Next handles it.
  let body: any;
  try {
    body = await req.json();
  } catch {
    // Not JSON, but HubSpot still expects a 200 or it retries
    console.log("[webhook] non-JSON body; returning 200 to avoid retries");
    return NextResponse.json({ ok: true, detail: "non-json" });
  }

  const { arrive, raw } = normalizePayload(body);

  // Useful trace for us
  const subtype = {
    subscriptionType: arrive?.subscriptionType,
    messageType: arrive?.messageType ?? null,
    changeFlag: arrive?.changeFlag ?? null,
  };
  console.log("[webhook] ARRIVE {");
  console.log("  subtype:", JSON.stringify(subtype), ",");
  console.log("}");

  // Step 1: shallow extract
  let messageId =
    pickFirst(
      arrive?.message?.messageId,
      arrive?.messageId,
      raw?.objectId /* sometimes present */
    ) || undefined;

  let toEmail =
    pickFirst(arrive?.message?.from?.email, arrive?.from?.email) || undefined;

  let text =
    pickFirst(arrive?.message?.text, arrive?.text) || undefined;

  let subject =
    pickFirst(arrive?.message?.subject, arrive?.subject) || undefined;

  // Flags for logging
  let hasEmail = !!toEmail;
  let hasText = !!text;

  console.log(
    "[webhook] shallow extract ->",
    JSON.stringify({ hasEmail, hasText, messageId })
  );

  // Step 2: deep lookup if missing any critical part
  if (!toEmail || !text) {
    if (!messageId) {
      // Without messageId we cannot lookup — bail early (keep HubSpot green)
      console.log(
        "[webhook] IGNORE missing (no messageId) { toEmail:",
        !!toEmail,
        ", text:",
        !!text,
        "}"
      );
      return NextResponse.json({
        ok: true,
        reason: "missing messageId for lookup",
      });
    }

    try {
      const base = process.env.NEXT_PUBLIC_BASE_URL || "";
      const url = `${base}/api/hubspot/lookup?messageId=${encodeURIComponent(
        String(messageId)
      )}&mode=deep`;

      const r = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
      const j = safeJson<any>(await r.json()) || {};

      // Your lookup route should return { ok, email, text, subject? }
      if (j?.ok) {
        toEmail = toEmail || j.email;
        text = text || j.text;
        subject = subject || j.subject;
      }

      hasEmail = !!toEmail;
      hasText = !!text;

      console.log(
        "[webhook] deep lookup ->",
        JSON.stringify({ status: r.status, hasEmail, hasText })
      );
    } catch (e: any) {
      console.log("[webhook] lookup error:", e?.message || String(e));
    }
  }

  // Dry-run stub (for your PowerShell tests & HubSpot “Ping”)
  if (isDry) {
    console.log("[webhook] DRYRUN echo");
    return NextResponse.json({
      ok: true,
      dryRun: true,
      toEmail: toEmail ?? null,
      subject: subject ?? "(none)",
      text: text ?? "(none)",
    });
  }

  // Final gate — if still missing, don’t spam retries; return OK + reason
  if (!toEmail || !text) {
    console.log(
      "[webhook] IGNORE missing { toEmail:",
      !!toEmail,
      ", text:",
      !!text,
      "}"
    );
    return NextResponse.json({
      ok: true,
      reason: "missing toEmail or text",
    });
  }

  // Step 3: forward to AI orchestrator (same contract we used earlier)
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || "";
    const url = `${base}/api/ai/orchestrate`;

    const payload = {
      mode: "estimate", // or “auto” if you prefer
      toEmail,
      subject: subject ?? "",
      text,
      messageId: messageId ?? "",
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log("[webhook] FORWARD -> /api/ai/orchestrate", res.status);

    // Keep HubSpot green no matter what
    return NextResponse.json({
      ok: true,
      forwarded: true,
      status: res.status,
    });
  } catch (e: any) {
    console.log("[webhook] forward error:", e?.message || String(e));
    // Still 200 to avoid repeated webhook retries
    return NextResponse.json({
      ok: false,
      error: "forward_failed",
    });
  }
}

// HubSpot also occasionally probes with GET
export async function GET() {
  return NextResponse.json({ ok: true, method: "GET" });
}
