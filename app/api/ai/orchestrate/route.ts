// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI Orchestrator with live quoting:
 * - Parses the email body for dims/qty/material hints via /api/parse/email-quote
 * - If sufficient, prices via /api/quote/foam-smart
 * - Crafts a concise reply (with a quote table if priced)
 * - dryRun=false -> POST /api/msgraph/send { to, subject, html }
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

const BASE = process.env.NEXT_PUBLIC_BASE_URL || "";

function s(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function bullets(arr: string[], max = 6) {
  return arr.slice(0, max).map((m) => `• ${m}`).join("\n");
}

function htmlQuoteTable(args: {
  unitPrice: number;
  total: number;
  qty: number;
  material?: string;
  kerfPct?: number;
  minCharge?: number;
}) {
  const { unitPrice, total, qty, material, kerfPct, minCharge } = args;
  const money = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 14px 0;font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px">
    <tr><td style="padding:4px 10px 4px 0;color:#555">Qty</td><td>${qty}</td></tr>
    <tr><td style="padding:4px 10px 4px 0;color:#555">Unit price</td><td>${money(unitPrice)}</td></tr>
    <tr><td style="padding:4px 10px 4px 0;color:#555">Total</td><td><b>${money(total)}</b></td></tr>
    ${material ? `<tr><td style="padding:4px 10px 4px 0;color:#555">Material</td><td>${material}</td></tr>` : ""}
    ${kerfPct != null ? `<tr><td style="padding:4px 10px 4px 0;color:#555">Kerf</td><td>${kerfPct}%</td></tr>` : ""}
    ${minCharge != null ? `<tr><td style="padding:4px 10px 4px 0;color:#555">Min charge</td><td>$${minCharge}</td></tr>` : ""}
  </table>`;
}

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as OrchestrateInput;
    const mode = s(input.mode || "ai");
    const toEmail = input.toEmail;
    const subject = s(input.subject || "Re: your message");
    const bodyText = s(input.text || "");
    const dryRun = !!input.dryRun;

    if (!isEmail(toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    // 1) Parse the email for dims/qty/etc.
    let parsed: any = null;
    let foamBody: any = null;
    let parseWarnings: string[] = [];
    try {
      const pRes = await fetch(`${BASE}/api/parse/email-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ text: bodyText }),
      });
      const pj = await pRes.json();
      if (pRes.ok && pj?.ok) {
        parsed = pj.parsed;
        parseWarnings = pj.warnings || [];
        foamBody = pj.foam_quote_body; // { length_in, width_in, height_in?, qty, cavities:[...], meta:{...} }
      }
    } catch {
      /* parsing is best-effort; keep going even if it fails */
    }

    // Decide if we can price now
    const canPrice =
      foamBody &&
      Number.isFinite(foamBody.length_in) &&
      Number.isFinite(foamBody.width_in) &&
      (Number.isFinite(foamBody.height_in) || (foamBody.weight_lbf && foamBody.area_in2)) &&
      Number.isFinite(foamBody.qty);

    // 2) If enough info, get a price from foam-smart
    let priced: null | {
      unitPrice: number;
      total: number;
      kerfPct?: number;
      minCharge?: number;
      materialName?: string;
      used_auto_thickness?: boolean;
    } = null;

    if (canPrice) {
      try {
        const qRes = await fetch(`${BASE}/api/quote/foam-smart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            length_in: foamBody.length_in,
            width_in: foamBody.width_in,
            height_in: foamBody.height_in, // may be undefined; foam-smart can auto-fill via cushion
            qty: foamBody.qty,
            material_id: foamBody.material_id ?? 1,
            cavities: foamBody.cavities ?? [],
            // Optional cushion inputs if user mentioned weight/area
            weight_lbf: foamBody.weight_lbf,
            area_in2: foamBody.area_in2,
            fragility_g: foamBody.fragility_g,
            drop_in: foamBody.drop_in,
          }),
        });
        const qj = await qRes.json();
        if (qRes.ok && qj?.ok) {
          priced = {
            unitPrice: Number(qj.unitPrice),
            total: Number(qj.total),
            kerfPct: qj.kerfPct,
            minCharge: qj.minCharge,
            materialName: qj.materialName,
            used_auto_thickness: qj.used_auto_thickness,
          };
        }
      } catch {
        /* non-fatal */
      }
    }

    // 3) Compose the reply
    const need: string[] = [];
    if (!foamBody?.length_in || !foamBody?.width_in) need.push("final outside dimensions (L × W × H)");
    if (!foamBody?.height_in) need.push("foam thickness (under or overall)");
    if (!foamBody?.qty) need.push("quantity");
    // Optional detail prompts:
    need.push("material (PE/EPE/PU/EVA) and density (e.g., 1.7 lb/ft³)");
    need.push("number of cavities and their sizes");

    const opening =
      "Thanks for reaching out — I can help quote your foam packaging quickly.";
    const ask =
      priced
        ? "Here’s a quick price based on what you shared:"
        : `To lock in pricing, could you confirm:\n${bullets(need, 5)}`;

    const money = (n: number) =>
      n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

    const txtLines: string[] = [opening, "", ask];

    let html = `
    <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
      <p>${opening}</p>
      <p>${priced ? "Here’s a quick price based on what you shared:" : "To lock in pricing, could you confirm:"}</p>
    `;

    if (priced) {
      html += htmlQuoteTable({
        unitPrice: priced.unitPrice,
        total: priced.total,
        qty: foamBody?.qty ?? 1,
        material: priced.materialName,
        kerfPct: priced.kerfPct,
        minCharge: priced.minCharge,
      });

      txtLines.push(
        `Unit price: ${money(priced.unitPrice)}`,
        `Qty: ${foamBody?.qty ?? 1}`,
        `Total: ${money(priced.total)}`
      );

      if (priced.used_auto_thickness) {
        html += `<p style="color:#555;margin:8px 0 0 0">We estimated thickness using your weight/area (cushion model). If you already know the thickness, tell me and I’ll reprice.</p>`;
        txtLines.push("Note: thickness was estimated using cushion model.");
      }
    } else {
      html += `<ul style="margin:0 0 12px 18px;padding:0">${need
        .slice(0, 5)
        .map((m) => `<li>${m}</li>`)
        .join("")}</ul>`;
    }

    html += `<p>If you have a sketch or photo, attach it—helps confirm cavity sizes and clearances.</p>`;
    html += `<p>— Alex-IO Estimator</p></div>`;

    const finalText = txtLines.join("\n");

    // 4) dryRun vs live send
    if (dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          to: toEmail,
          subject,
          text: finalText,
          htmlPreview: html,
          priced: !!priced,
        },
        { status: 200 }
      );
    }

    const sendRes = await fetch(`${BASE}/api/msgraph/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        to: toEmail,
        subject,
        html,
      }),
    });

    const sendJson = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok || sendJson?.ok === false) {
      return NextResponse.json(
        { ok: false, error: "graph_send_failed", status: sendRes.status, sendJson },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, sent: true, to: toEmail, priced: !!priced, status: sendRes.status },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "orchestrate_failed" }, { status: 500 });
  }
}
