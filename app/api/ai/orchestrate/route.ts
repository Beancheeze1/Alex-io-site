// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI Orchestrator (no external LLM)
 * Accepts:
 * {
 *   mode: "ai",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,
 *   inReplyTo?: string | null,
 *   dryRun?: boolean,
 *   // NEW (optional)
 *   sketchRefs?: string[] // e.g., ids/urls from /api/uploads/sketch
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

const s = (v: unknown) => String(v ?? "").trim();

function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v));
}







export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<OrchestrateInput>;
    const input: OrchestrateInput = {
      mode: "ai",
      toEmail: s(body.toEmail),
      subject: s(body.subject || "Re: your message"),
      text: s(body.text),
      inReplyTo: body.inReplyTo ?? null,
      dryRun: Boolean(body.dryRun),
      sketchRefs: Array.isArray(body.sketchRefs) ? body.sketchRefs.filter((x) => s(x).length > 0) : [],
    };

    if (!isEmail(input.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    const reply = buildReply(input);

    return NextResponse.json(
      {
        ok: true,
        dryRun: !!input.dryRun,
        to: input.toEmail,
        subject: input.subject,
        htmlPreview: reply.html,
        missingDetected: reply.missing,
        inReplyTo: input.inReplyTo ?? "",
        src: reply.src,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "orchestration error" }, { status: 500 });
  }
}

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
