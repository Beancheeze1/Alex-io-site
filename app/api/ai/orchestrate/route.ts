// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI Orchestrator (no external LLM) — v2.1 heuristics widened
 * - Keeps your preview & forwarding behavior
 * - Expands regex: qty, density (pcf, per cubic foot), fractions for thickness, inch symbol (")
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

    const reply = buildReply(input);
    const htmlToSend = input.html && input.html.length > 0 ? input.html : reply.html;

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
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok) {
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
    return NextResponse.json(
      { ok: false, error: e?.message || "orchestration error" },
      { status: 500 }
    );
  }
}

/* =========================
   Heuristics (widened)
   ========================= */

function buildReply(input: OrchestrateInput) {
  const raw = s(input.text);

  // Dimensions (unchanged)
  const hasDims =
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.test(raw) ||
    /\bL\s*=?\s*\d+(?:\.\d+)?\b.*\bW\s*=?\s*\d+(?:\.\d+)?\b.*\bH\s*=?\s*\d+(?:\.\d+)?\b/i.test(raw);

  // Quantity (widened but avoids false positives with 12 x 8 x 2)
  const qtyMatch =
    raw.match(/\b(?:qty|quantity)\s*[:=]?\s*(\d{1,5})\b/i) ||
    raw.match(/\b(\d{1,5})\s*(?:pcs?|pieces?|units?|ea)\b/i) ||
    raw.match(/\b(?:need|for|make|order)\s+(\d{1,5})\b/i) ||
    raw.match(/\b(?:about|approx(?:\.|imately)?)\s*(\d{1,5})\b/i);
  const hasQty = !!qtyMatch;

  // Density (adds pcf and 'per cubic foot' variants)
  const hasDensity =
    /\b(\d(?:\.\d+)?)\s*(?:lb|pounds?)\s*(?:\/\s*(?:ft3|ft\^?3|ft³)|\s*per\s*(?:ft3|cubic\s*foot))\b/i.test(raw) ||
    /\b(\d(?:\.\d+)?)\s*pcf\b/i.test(raw) ||
    /\b(PE|EPE|PU|EVA)\b.*\b\d(?:\.\d+)?\b/i.test(raw);

  // Thickness under (adds fractions and inch symbol ")
  const hasThicknessUnder =
    /\b(thickness|under|bottom)\b.*?\b((?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+))\s*(in|inch|inches|mm|millimeters?|")\b/i.test(raw);

  // Units (adds inch symbol and cm)
  const unitsMentioned =
    /\b(mm|millimeter|millimeters|cm|centimeter|centimeters|in|inch|inches)\b|"/i.test(raw);

  const missing: string[] = [];
  if (!hasDims) missing.push("final outside dimensions (L × W × H)");
  if (!hasQty) missing.push("quantity");
  if (!hasDensity) missing.push("foam density (e.g., 1.7 lb/ft³ or 1.7 pcf)");
  if (!hasThicknessUnder) missing.push("thickness under the part");
  if (!unitsMentioned) missing.push('units (in, ", or mm)');

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
async function safeText(r: Response) { try { return await r.text(); } catch { return null; } }
