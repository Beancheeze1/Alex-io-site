// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI Orchestrator (no external LLM) — v2 baseline merge
 * - Preserves your preview & spec-heuristics
 * - When dryRun=false, forwards to /api/msgraph/send
 *
 * Accepts JSON:
 * {
 *   mode: "ai",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,
 *   html?: string,               // optional override; if provided we send this
 *   inReplyTo?: string | null,
 *   dryRun?: boolean,
 *   sketchRefs?: string[]
 * }
 */
type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
  sketchRefs?: string[];
};

type OrchestrateInputIncoming = OrchestrateInput & { html?: string };

const s = (v: unknown) => String(v ?? "").trim();

function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<OrchestrateInputIncoming>;

    const input: OrchestrateInputIncoming = {
      mode: "ai",
      toEmail: s(body.toEmail),
      // Keep your polite default subject for new threads
      subject: s(body.subject || "Re: your message"),
      text: s(body.text),
      html: s(body.html),
      inReplyTo: body.inReplyTo ?? null,
      dryRun: Boolean(body.dryRun),
      sketchRefs: Array.isArray(body.sketchRefs)
        ? body.sketchRefs.filter((x) => s(x).length > 0)
        : [],
    };

    if (!isEmail(input.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    // Your existing reply builder (kept intact)
    const reply = buildReply(input);

    // If caller provided explicit HTML, prefer it; otherwise use our generated preview HTML
    const htmlToSend = input.html && input.html.length > 0 ? input.html : reply.html;

    // DRY RUN -> return your preview, no network call
    if (input.dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          to: input.toEmail,
          subject: input.subject,
          htmlPreview: htmlToSend,
          missingDetected: reply.missing,
          inReplyTo: input.inReplyTo ?? "",
          src: reply.src,
          forwarded: false,
        },
        { status: 200 }
      );
    }

    // LIVE SEND -> forward to /api/msgraph/send
    const sendPayload: Record<string, any> = {
      to: input.toEmail,
      subject: input.subject,
      html: htmlToSend,
    };
    if (input.inReplyTo) sendPayload.inReplyTo = input.inReplyTo;

    const res = await fetch(getInternalUrl("/api/msgraph/send"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sendPayload),
    });

    const text = await safeText(res);
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

    if (!res.ok) {
      // Soft-fail (200) so upstream chains don't hard error; include detail for debugging
      return NextResponse.json(
        {
          ok: false,
          error: "msgraph/send failed",
          status: res.status,
          detail: data ?? text ?? null,
          to: input.toEmail,
          subject: input.subject,
          inReplyTo: input.inReplyTo ?? "",
          missingDetected: reply.missing,
          forwarded: "/api/msgraph/send",
        },
        { status: 200 }
      );
    }

    // Success passthrough
    return NextResponse.json(
      {
        ok: true,
        dryRun: false,
        to: input.toEmail,
        subject: input.subject,
        inReplyTo: input.inReplyTo ?? "",
        missingDetected: reply.missing,
        forwarded: "/api/msgraph/send",
        result: data ?? text ?? null,
      },
      { status: 200 }
    );
  } catch (e: any) {
    // Preserve your error style but return JSON that won't explode dashboards
    return NextResponse.json(
      { ok: false, error: e?.message || "orchestration error" },
      { status: 500 }
    );
  }
}

/* =========================
   Your original builder (unchanged)
   ========================= */

function buildReply(input: OrchestrateInput) {
  const raw = s(input.text);

  // Spec heuristics
  const hasDims =
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.test(raw) ||
    /\bL\s*=?\s*\d+(?:\.\d+)?\b.*\bW\s*=?\s*\d+(?:\.\d+)?\b.*\bH\s*=?\s*\d+(?:\.\d+)?\b/i.test(raw);

  const qtyMatch =
    raw.match(/\bqty\s*[:=]?\s*(\d+)\b/i) ||
    raw.match(/\b(\d+)\s*(pcs|pieces|units|ea)\b/i) ||
    raw.match(/\b(?:need|for|make)\s+(\d{1,5})\b/i);
  const hasQty = !!qtyMatch;

  const hasDensity =
    /\b(1(\.\d+)?|2(\.\d+)?|3(\.\d+)?)\s*(lb|pounds?)\s*\/?\s*ft3\b/i.test(raw) ||
    /\b(PE|EPE|PU|EVA)\b.*\b\d(\.\d+)?\b/i.test(raw);

  const hasThicknessUnder =
    /\b(thickness|under|bottom)\b.*\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i.test(raw);

  const unitsMentioned = /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(raw);

  const missing: string[] = [];
  if (!hasDims) missing.push("final outside dimensions (L × W × H)");
  if (!hasQty) missing.push("quantity");
  if (!hasDensity) missing.push("foam density (e.g., 1.7 lb/ft³ PE)");
  if (!hasThicknessUnder) missing.push("thickness under the part");
  if (!unitsMentioned) missing.push("units (in or mm)");

  // If sketches are already on file, don't ask for one again.
  const hasSketch = (input.sketchRefs?.length || 0) > 0;

  const promptPart =
    missing.length > 0
      ? `To lock in pricing, could you confirm${hasSketch ? "" : " (or attach a sketch)"}:`
      : `Great — I can run pricing; I’ll prepare a quote and send it right back.`;

  const listHtml =
    missing.length > 0
      ? `<ul style="margin:0 0 12px 18px;padding:0">${missing
          .slice(0, 4)
          .map((m) => `<li>${m}</li>`)
          .join("")}</ul>`
      : "";

  const sketchLine = hasSketch
    ? `<p>Noted — I have your sketch on file and will use it to confirm cavity placement and edge clearances.</p>`
    : `<p>If you have a sketch or photo, attach it—it helps confirm cavity sizes and clearances.</p>`;

  const html = `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    <p>${promptPart}</p>
    ${listHtml}
    ${sketchLine}
    <p>— Alex-IO Estimator</p>
  </div>`.trim();

  return {
    missing,
    html,
    src: {
      hasDims,
      hasQty,
      hasDensity,
      hasThicknessUnder,
      unitsMentioned,
      hasSketch,
    },
  };
}

/* =========================
   Helpers
   ========================= */

function getInternalUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") || "http://localhost:3000";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function safeText(r: Response) {
  try { return await r.text(); } catch { return null; }
}
