// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Minimal AI orchestrator (no external LLM dependency)
 * - Input JSON:
 *   {
 *     "mode": "ai",
 *     "toEmail": "customer@example.com",
 *     "subject": "Re: your message",
 *     "text": "customer's email body",
 *     "inReplyTo": "optional-message-id",
 *     "dryRun": true|false,
 *     "ai": { "task": "...", "hints": ["...","..."] },
 *     "hubspot": { "objectId": "optional-thread-id" }
 *   }
 *
 * - Behavior:
 *   * Composes a concise, helpful reply that nudges toward quoting
 *   * Detects missing specs (dims, qty, density, thickness-under-part, units)
 *   * If dryRun=true => returns preview only, no send
 *   * If dryRun=false => POSTs to /api/msgraph/send { to, subject, html }
 *
 * NOTE: We intentionally send only {to, subject, html} to match your existing msgraph route.
 *       /api/msgraph/send already sets the loop header so our webhook won’t echo itself.
 */

type OrchestrateInput = {
  mode?: string;
  toEmail?: string;
  subject?: string;
  text?: string;
  inReplyTo?: string;
  dryRun?: boolean;
  ai?: { task?: string; hints?: string[] };
  hubspot?: { objectId?: string | number };
};

function s(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function buildReply(input: OrchestrateInput) {
  const raw = s(input.text);

  // Very light heuristics to detect specs in the customer's email
  const hasDims =
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.test(raw) ||
    /\bL\s*=?\s*\d+(?:\.\d+)?\b.*\bW\s*=?\s*\d+(?:\.\d+)?\b.*\bH\s*=?\s*\d+(?:\.\d+)?\b/i.test(raw);

  const qtyMatch = raw.match(/\bqty\s*[:=]?\s*(\d+)\b/i) || raw.match(/\b(\d+)\s*(pcs|pieces|units|ea)\b/i);
  const hasQty = !!qtyMatch;

  const hasDensity = /\b(1(\.\d+)?|2(\.\d+)?|3(\.\d+)?)\s*(lb|pounds?)\s*\/?\s*ft3\b/i.test(raw) ||
    /\b(PE|EPE|PU|EVA)\b.*\b\d(\.\d+)?\b/i.test(raw);

  const hasThicknessUnder = /\b(thickness|under|bottom)\b.*\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i.test(raw);

  const unitsMentioned = /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(raw);

  // Build a concise response with up to ~120 words
  const missing: string[] = [];
  if (!hasDims) missing.push("final outside dimensions (L × W × H)");
  if (!hasQty) missing.push("quantity");
  if (!hasDensity) missing.push("foam density (e.g., 1.7 lb/ft³ PE)");
  if (!hasThicknessUnder) missing.push("thickness under the part");
  if (!unitsMentioned) missing.push("unit system (inches or mm)");

  const bullets = missing.slice(0, 4).map((m) => `• ${m}`).join("\n");

  const opener =
    "Thanks for reaching out — I can help quote your foam packaging quickly.";
  const ask =
    missing.length > 0
      ? `To lock in pricing, could you confirm:\n${bullets}`
      : "I have enough to run pricing; I’ll prepare a quote and send it right back.";
  const closer =
    "If you have a sketch or photo, feel free to attach it — that helps us confirm cavity placement and edge clearances.";

  const bodyText = `${opener}\n\n${ask}\n\n${closer}\n\n— Alex-IO Estimator`;

  // Keep HTML simple and Outlook-friendly
  const html = `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    <p>${missing.length > 0 ? "To lock in pricing, could you confirm:" : "I have enough to run pricing; I’ll prepare a quote and send it right back."}</p>
    ${
      missing.length > 0
        ? `<ul style="margin:0 0 12px 18px;padding:0">${missing
            .slice(0, 4)
            .map((m) => `<li>${m}</li>`)
            .join("")}</ul>`
        : ""
    }
    <p>If you have a sketch or photo, feel free to attach it — that helps us confirm cavity placement and edge clearances.</p>
    <p style="margin-top:16px">— Alex-IO Estimator</p>
  </div>`.trim();

  // Subject
  const subject =
    s(input.subject) || "Re: your message to Alex-IO";

  return { subject, html, missing };
}

export async function GET() {
  // Simple probe so you always get JSON in your tests
  return NextResponse.json({ ok: true, route: "/api/ai/orchestrate" });
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const selfBase = `${url.protocol}//${url.host}`;
    const SEND =
      process.env.INTERNAL_SEND_URL || new URL("/api/msgraph/send", url).toString();

    const body = (await req.json()) as OrchestrateInput;
    if (body?.mode !== "ai") {
      return NextResponse.json(
        { ok: false, error: "mode_must_be_ai" },
        { status: 400 }
      );
    }

    const toEmail = body?.toEmail;
    if (!isEmail(toEmail)) {
      return NextResponse.json(
        { ok: false, error: "invalid_toEmail" },
        { status: 400 }
      );
    }

    // Compose the reply (deterministic “AI-like” for now; no LLM dependency)
    const { subject, html, missing } = buildReply(body);

    // Respect dryRun: return preview, do not send
    const dryRun = !!body?.dryRun;
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        to: toEmail,
        subject,
        htmlPreview: html.slice(0, 300),
        missingDetected: missing,
      });
    }

    // LIVE SEND: call your existing Graph sender
    const res = await fetch(SEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        to: toEmail,
        subject,
        html,
        // NOTE: We do NOT add new params (e.g., inReplyTo) to avoid breaking your working sender.
        // Your /api/msgraph/send already sets loop headers to prevent webhook echo loops.
      }),
    });

    const sendJson = await res.json().catch(() => ({}));
    if (!res.ok || sendJson?.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: "graph_send_failed",
          status: res.status,
          detail: sendJson?.error ?? sendJson,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      to: toEmail,
      subject,
      graph: { status: res.status, route: "/api/msgraph/send", note: "live" },
      missingDetected: missing,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "orchestrate_exception" },
      { status: 500 }
    );
  }
}
