// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { absoluteUrl } from "@/app/lib/internalFetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v));

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<OrchestrateInput>;
    const input: OrchestrateInput = {
      mode: "ai",
      toEmail: s(body.toEmail),
      subject: s(body.subject || "Re: your message"),
      text: s(body.text),
      inReplyTo: body.inReplyTo ?? null,
      dryRun: !!body.dryRun,
      sketchRefs: Array.isArray(body.sketchRefs) ? body.sketchRefs.filter(x => s(x).length>0) : [],
    };

    if (!isEmail(input.toEmail)) {
      return NextResponse.json({ ok:false, error:"invalid toEmail" }, { status:400 });
    }

    const reply = await buildReply(req, input);

    return NextResponse.json({
      ok: true,
      dryRun: !!input.dryRun,
      to: input.toEmail,
      subject: input.subject,
      htmlPreview: reply.html,
      missingDetected: reply.missing,
      inReplyTo: input.inReplyTo ?? "",
      src: reply.src,
      price: reply.price ?? null,
    }, { status:200 });

  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || "orchestration error" }, { status:500 });
  }
}

function parseDims(raw: string){
  const m1 = raw.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  const m2 = raw.match(/\bL\s*=?\s*(\d+(?:\.\d+)?)\b.*\bW\s*=?\s*(\d+(?:\.\d+)?)\b.*\bH\s*=?\s*(\d+(?:\.\d+)?)/i);
  if (m1) return { L: Number(m1[1]), W: Number(m1[2]), H: Number(m1[3]) };
  if (m2) return { L: Number(m2[1]), W: Number(m2[2]), H: Number(m2[3]) };
  return null;
}

async function buildReply(req: NextRequest, input: OrchestrateInput) {
  const raw = s(input.text);

  const dims = parseDims(raw);
  const unitsMentioned = /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(raw);

  const qtyMatch =
    raw.match(/\bqty\s*[:=]?\s*(\d+)\b/i) ||
    raw.match(/\b(\d+)\s*(pcs|pieces|units|ea)\b/i) ||
    raw.match(/\b(?:need|for|make)\s+(\d{1,5})\b/i);
  const qty = qtyMatch ? Number(qtyMatch[1]) : null;

  const densityMatch =
    raw.match(/\b(\d+(?:\.\d+)?)\s*(lb|pounds?)\s*\/?\s*ft3\b/i) ||
    raw.match(/\b(\d+(?:\.\d+)?)\s*(pcf)\b/i) ||
    raw.match(/\b(?:PE|EPE|PU|EVA)\b.*?\b(\d+(?:\.\d+)?)\b/i);
  const density = densityMatch ? Number(densityMatch[1]) : null;

  const thickMatch = raw.match(/\b(thickness|under|bottom)\b.*?\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i);
  const thicknessUnder = thickMatch ? Number(thickMatch[2]) : null;

  const missing: string[] = [];
  if (!dims) missing.push("final outside dimensions (L × W × H)");
  if (!qty) missing.push("quantity");
  if (!density) missing.push("foam density (e.g., 1.7 lb/ft³ or 1.7 pcf)");
  if (!thicknessUnder) missing.push("thickness under the part");
  if (!unitsMentioned) missing.push("units (in or mm)");

  const hasSketch = (input.sketchRefs?.length || 0) > 0;

  let priceBlock = "";
  let pricePayload: any = null;

  const haveEnoughForPrice = !!dims && !!qty && !!density && unitsMentioned;

  if (haveEnoughForPrice) {
    // call local /api/ai/price
    const url = absoluteUrl(req, "/api/ai/price");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slots: {
          internal_length_in: dims!.L,
          internal_width_in:  dims!.W,
          internal_height_in: dims!.H,
          thickness_under_in: thicknessUnder ?? 0,
          qty,
          density_lbft3: density,
          cavities: [],
        }
      }),
      cache: "no-store",
    });

    if (res.ok) {
      const j = await res.json();
      if (j?.ok) {
        pricePayload = j;
        const total = j?.pricing?.total;
        const mat = j?.material?.name ?? "";
        priceBlock = `<p><strong>Prelim price:</strong> $${Number(total).toFixed(2)} (${mat}). I’ll firm this up after we confirm details.</p>`;
      }
    }
  }

  const promptPart =
    missing.length > 0
      ? `To lock in pricing, could you confirm${hasSketch ? "" : " (or attach a sketch)"}:`
      : `Great — I can run pricing; I’ll prepare a quote and send it right back.`;

  const listHtml =
    missing.length > 0
      ? `<ul style="margin:0 0 12px 18px;padding:0">${missing.slice(0, 4).map((m)=>`<li>${m}</li>`).join("")}</ul>`
      : "";

  const sketchLine = hasSketch
    ? `<p>Noted — I have your sketch on file and will use it to confirm cavity placement and clearances.</p>`
    : `<p>If you have a sketch or photo, attach it—it helps confirm cavity sizes and clearances.</p>`;

  const priceLine = priceBlock || "";

  const html = `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    ${priceLine}
    <p>${promptPart}</p>
    ${listHtml}
    ${sketchLine}
    <p>— Alex-IO Estimator</p>
  </div>`.trim();

  return {
    missing,
    html,
    src: {
      hasDims: !!dims,
      hasQty: !!qty,
      hasDensity: !!density,
      hasThicknessUnder: !!thicknessUnder,
      unitsMentioned,
      hasSketch,
      priced: !!pricePayload,
    },
    price: pricePayload,
  };
}
