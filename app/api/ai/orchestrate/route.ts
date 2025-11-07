// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { absoluteUrl } from "@/app/lib/internalFetch";
import { extractSpecs } from "@/app/lib/ai/extract";

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
      // NEW: give the UI/logs structured extraction + search helpers
      extracted: reply.extracted,
      price: reply.price ?? null,
    }, { status:200 });

  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || "orchestration error" }, { status:500 });
  }
}

async function buildReply(req: NextRequest, input: OrchestrateInput) {
  const raw = s(input.text);
  const ex = extractSpecs(raw);

  const missing: string[] = [];
  if (!ex.dims) missing.push("final outside dimensions (L × W × H)");
  if (!ex.qty) missing.push("quantity");
  if (!ex.density_pcf) missing.push("foam density (e.g., 1.7 pcf)");
  if (ex.thickness_under_in == null) missing.push("thickness under the part");
  if (!ex.unitsMentioned) missing.push("units (in or mm)");

  const hasSketch = (input.sketchRefs?.length || 0) > 0;

  let priceBlock = "";
  let pricePayload: any = null;

  const haveEnoughForPrice = !!ex.dims && !!ex.qty && !!ex.density_pcf && ex.unitsMentioned;
  if (haveEnoughForPrice) {
    const url = absoluteUrl(req, "/api/ai/price");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        slots: {
          internal_length_in: ex.dims!.L_in,
          internal_width_in:  ex.dims!.W_in,
          internal_height_in: ex.dims!.H_in,
          thickness_under_in: ex.thickness_under_in ?? 0,
          qty: ex.qty!,
          density_lbft3: ex.density_pcf!,   // compatible: treat pcf == lb/ft^3 numerically
          cavities: [],
        }
      })
    });
    if (res.ok) {
      const j = await res.json();
      if (j?.ok) {
        pricePayload = j;
        const total = j?.pricing?.total;
        const mat = j?.material?.name ?? "";
        priceBlock = `<p><strong>Prelim price:</strong> $${Number(total).toFixed(2)} ${mat ? `(${mat})` : ""}. I’ll firm this up after we confirm details.</p>`;
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
    ? `<p>Noted — I have your sketch on file and will use it to confirm cavity placement and edge clearances.</p>`
    : `<p>If you have a sketch or photo, attach it—it helps confirm cavity sizes and clearances.</p>`;

  const html = `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    ${priceBlock}
    <p>${promptPart}</p>
    ${listHtml}
    ${sketchLine}
    <p>— Alex-IO Estimator</p>
  </div>`.trim();

  return {
    missing,
    html,
    src: {
      hasDims: !!ex.dims,
      hasQty: !!ex.qty,
      hasDensity: !!ex.density_pcf,
      hasThicknessUnder: ex.thickness_under_in != null,
      unitsMentioned: ex.unitsMentioned,
      hasSketch,
      priced: !!pricePayload,
    },
    price: pricePayload,
    extracted: ex,  // <— includes searchWords[] and dbFilter
  };
}
