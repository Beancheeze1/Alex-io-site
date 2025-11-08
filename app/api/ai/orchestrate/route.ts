// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Orchestrate v2 (no external LLM)
 * Accepts:
 * {
 *   mode: "ai",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,
 *   inReplyTo?: string | null,
 *   dryRun?: boolean,
 *   sketchRefs?: string[]   // optional ids/urls previously uploaded
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

// What the route returns (public shape kept simple/stable)
type OrchestrateResponse = {
  ok: boolean;
  dryRun: boolean;
  to: string;
  subject: string;
  htmlPreview: string;
  missing: string[];
  src: ReplyBits["src"];
  // inert placeholders so callers that expect these keys won't break
  quote: unknown;
  extracted: unknown;
  suggested: {
    count: number;
    items: unknown[];
    top?: unknown;
  };
};

const s = (v: unknown) => String(v ?? "").trim();

function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v));
}

type ReplyBits = {
  html: string;
  missing: string[];
  src: {
    hasDims: boolean;
    hasQty: boolean;
    hasDensity: boolean;
    hasThicknessUnder: boolean;
    unitsMentioned: boolean;
    hasSketch: boolean;
  };
};

/**
 * Build the reply preview and the list of still-missing fields.
 * Pure string/regex heuristics – no external calls.
 */
function buildReply(input: OrchestrateInput): ReplyBits {
  const raw = s(input.text);

  // Dimensions like `12 x 9 x 2`, `12x9x2`, or "L=12 W=9 H=2"
  const hasDims =
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.test(raw) ||
    /\bL\s*=?\s*\d+(?:\.\d+)?\b.*\bW\s*=?\s*\d+(?:\.\d+)?\b.*\bH\s*=?\s*\d+(?:\.\d+)?\b/i.test(raw);

  // Quantity (qty: 24), or "need 24", or "24 pcs"
  const qtyMatch =
    raw.match(/\bqty\s*[:=]?\s*(\d+)\b/i) ||
    raw.match(/\b(\d{1,6})\s*(pcs|pieces|units|ea)\b/i) ||
    raw.match(/\b(?:need|for|make)\s+(\d{1,6})\b/i);
  const hasQty = !!qtyMatch;

  // Density & foam family (accept pcf, lb/ft³, family tokens)
  const hasDensity =
    /\b(?:pcf|lb\/?ft3|lb\/?ft\^?3|lb\s*per\s*cubic\s*foot)\b/i.test(raw) ||
    /\b(PE|EPE|PU|EVA|XLPE|ESTER)\b/i.test(raw) ||
    /\b\d(?:\.\d+)?\s*(?:pcf|lb\/?ft3)\b/i.test(raw) ||
    /\b(?:1(?:\.\d+)?|2(?:\.\d+)?|3(?:\.\d+)?)\s*(?:pcf|lb\/?ft3)\b/i.test(raw);

  // Thickness under part
  const hasThicknessUnder =
    /\b(thickness|under|bottom)\b.*\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i.test(raw);

  // Units mention
  const unitsMentioned = /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(raw);

  // Any uploaded sketch refs?
  const hasSketch = !!(input.sketchRefs && input.sketchRefs.length > 0);

  const missing: string[] = [];
  if (!hasDims) missing.push("final outside dimensions (L × W × H)");
  if (!hasQty) missing.push("quantity");
  if (!hasDensity) missing.push("foam density (e.g., 1.7 pcf / PE family)");
  if (!hasThicknessUnder) missing.push("thickness under the part");
  if (!unitsMentioned) missing.push("units (in or mm)");

  const promptLine =
    missing.length > 0
      ? `To lock in pricing, could you confirm${hasSketch ? "" : " (or attach a sketch)"}:`
      : `Great — I can run pricing; I’ll prepare a quote and send it right back.`;

  const listHtml =
    missing.length > 0
      ? `<ul style="margin:0 0 12px 18px;padding:0">${missing
          .slice(0, 6)
          .map((m) => `<li>${m}</li>`)
          .join("")}</ul>`
      : "";

  const sketchLine = hasSketch
    ? `<p>Noted — I have your sketch on file and will use it to confirm cavity placement and edge clearances.</p>`
    : `<p>If you have a sketch or photo, attach it — it helps confirm cavity sizes and clearances.</p>`;

  const html = `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    <p>${promptLine}</p>
    ${listHtml}
    ${sketchLine}
    <p>— Alex-IO Estimator</p>
  </div>`.trim();

  return {
    html,
    missing,
    src: { hasDims, hasQty, hasDensity, hasThicknessUnder, unitsMentioned, hasSketch },
  };
}

export async function POST(req: NextRequest) {
  try {
    const bodyRaw = (await req.json()) as Partial<OrchestrateInput>;
    const body: OrchestrateInput = {
      mode: "ai",
      toEmail: s(bodyRaw.toEmail),
      subject: s(bodyRaw.subject || "Re: your message"),
      text: s(bodyRaw.text),
      inReplyTo: bodyRaw.inReplyTo ?? null,
      dryRun: Boolean(bodyRaw.dryRun),
      sketchRefs: Array.isArray(bodyRaw.sketchRefs)
        ? bodyRaw.sketchRefs.map(s).filter(Boolean)
        : [],
    };

    if (!isEmail(body.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    // Build preview + missing-fields list (the heart of this AI-less orchestrator)
    const reply = buildReply(body);

    const payload: OrchestrateResponse = {
      ok: true,
      dryRun: !!body.dryRun,
      to: body.toEmail,
      subject: body.subject || "Re: your message",
      htmlPreview: reply.html,
      missing: reply.missing,
      src: reply.src,
      // no quote generation here (kept for compatibility with callers that read these keys)
      quote: null,
      extracted: null,
      suggested: { count: 0, items: [] },
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "orchestration error" },
      { status: 500 }
    );
  }
}
