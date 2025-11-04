// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { memGet, memMergeSpecs, memAppendTurn } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrchestrateInput = {
  toEmail?: string;
  subject?: string;
  text?: string;
  inReplyTo?: string;      // <- from webhook (Internet Message-Id)
  dryRun?: boolean;
  hubspot?: { objectId?: string | number };
};

const BASE = process.env.NEXT_PUBLIC_BASE_URL || "";

function s(x: unknown): string { return typeof x === "string" ? x : x == null ? "" : String(x); }
function isEmail(v: unknown): v is string { return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

function htmlQuoteTable(args: { unitPrice: number; total: number; qty: number; material?: string; kerfPct?: number; minCharge?: number; }) {
  const { unitPrice, total, qty, material, kerfPct, minCharge } = args;
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
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
    const toEmail = input.toEmail;
    const subject = s(input.subject || "Re: your message");
    const bodyText = s(input.text || "");
    const inReplyTo = s(input.inReplyTo || "");
    const dryRun = !!input.dryRun;

    if (!isEmail(toEmail)) return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });

    // -------- Memory: get last known specs for this (email, subjectBase)
    const memBefore = await memGet(toEmail, subject);
    const defaults = memBefore?.specs || {};

    // -------- Parse
    let foamBody: any = null;
    try {
      const pRes = await fetch(`${BASE}/api/parse/email-quote`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ text: bodyText }),
      });
      const pj = await pRes.json();
      if (pRes.ok && pj?.ok) foamBody = pj.foam_quote_body;
    } catch {}

    // Merge defaults from memory if fields are missing
    const merged = {
      length_in: foamBody?.length_in ?? defaults.length_in,
      width_in:  foamBody?.width_in  ?? defaults.width_in,
      height_in: foamBody?.height_in ?? defaults.height_in,
      qty:       foamBody?.qty       ?? defaults.qty,
      material_id: foamBody?.material_id ?? defaults.material_id ?? 1,
      cavities:  foamBody?.cavities ?? [],
      weight_lbf: foamBody?.weight_lbf ?? defaults.weight_lbf,
      area_in2:   foamBody?.area_in2   ?? defaults.area_in2,
      fragility_g: foamBody?.fragility_g ?? defaults.fragility_g,
      drop_in:     foamBody?.drop_in     ?? defaults.drop_in,
    };

    const canPrice =
      Number.isFinite(merged.length_in) &&
      Number.isFinite(merged.width_in) &&
      (Number.isFinite(merged.height_in) || (merged.weight_lbf && merged.area_in2)) &&
      Number.isFinite(merged.qty);

    // -------- Price
    let priced: null | {
      unitPrice: number; total: number; kerfPct?: number; minCharge?: number; materialName?: string; used_auto_thickness?: boolean;
    } = null;

    if (canPrice) {
      try {
        const qRes = await fetch(`${BASE}/api/quote/foam-smart`, {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify(merged),
        });
        const raw = await qRes.text();
        let qj: any = {};
        try { qj = JSON.parse(raw); } catch { qj = { ok: false, parseError: raw?.slice?.(0, 400) }; }
        console.log("[foam-smart result]", qRes.status, qj);

        if (qRes.ok && qj?.ok) {
          const q = qj.quote || qj;
          const u = Number(q.unitPrice) || Number(q.piece_price_usd) || Number(q.pricing?.piece_price_usd);
          const t = Number(q.total)     || Number(q.total_price_usd) || Number(q.pricing?.total_price_usd);
          if (Number.isFinite(u) && Number.isFinite(t)) {
            priced = {
              unitPrice: u, total: t,
              kerfPct: Number.isFinite(Number(q.kerfPct)) ? Number(q.kerfPct) : undefined,
              minCharge: Number.isFinite(Number(q.minCharge)) ? Number(q.minCharge) : undefined,
              materialName: typeof q.materialName === "string" ? q.materialName : undefined,
              used_auto_thickness: !!q.used_auto_thickness,
            };
          } else {
            console.warn("[foam-smart warn] ok:true but unitPrice/total not numeric", q);
          }
        }
      } catch (err) {
        console.error("[foam-smart exception]", (err as any)?.message || String(err));
      }
    }

    // -------- Compose
    const missing: string[] = [];
    if (!Number.isFinite(merged.length_in) || !Number.isFinite(merged.width_in)) missing.push("final outside dimensions (L × W × H)");
    if (!Number.isFinite(merged.height_in)) missing.push("foam thickness (under or overall)");
    if (!Number.isFinite(merged.qty)) missing.push("quantity");

    const opening = "Thanks for reaching out — I can help quote your foam packaging quickly.";
    let html = `
      <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
        <p>${opening}</p>
        <p>${priced ? "Here’s a quick price based on what you shared:" : "To lock in pricing, could you confirm:"}</p>
    `;

    if (priced) {
      const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
      html += htmlQuoteTable({
        unitPrice: priced.unitPrice, total: priced.total, qty: merged.qty ?? 1,
        material: priced.materialName, kerfPct: priced.kerfPct, minCharge: priced.minCharge,
      });
    } else {
      html += `<ul style="margin:0 0 12px 18px;padding:0">${missing.map(m => `<li>${m}</li>`).join("")}</ul>`;
    }

    html += `<p>If you have a sketch or photo, attach it—helps confirm cavity sizes and clearances.</p>`;
    html += `<p>— Alex-IO Estimator</p></div>`;

    // -------- Memory: save what we learned
    await memMergeSpecs(toEmail, subject, {
      length_in: merged.length_in, width_in: merged.width_in, height_in: merged.height_in,
      qty: merged.qty, material_id: merged.material_id, weight_lbf: merged.weight_lbf,
      area_in2: merged.area_in2, fragility_g: merged.fragility_g, drop_in: merged.drop_in,
    });
    await memAppendTurn(toEmail, subject, "user", bodyText.slice(0, 4000));
    await memAppendTurn(toEmail, subject, "assistant", priced ? "[quoted]" : "[asked for details]");

    // -------- Dry run
    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, priced: !!priced, preview: html }, { status: 200 });
    }

    // -------- Send (now thread-aware)
    const sendRes = await fetch(`${BASE}/api/msgraph/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        to: toEmail,
        subject,
        html,
        inReplyTo: inReplyTo || undefined,
        // references can be chained later if you capture it in lookup
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok || sendJson?.ok === false) {
      return NextResponse.json({ ok: false, error: "graph_send_failed", status: sendRes.status, sendJson }, { status: 200 });
    }

    return NextResponse.json({ ok: true, sent: true, to: toEmail, priced: !!priced, status: sendRes.status }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "orchestrate_failed" }, { status: 500 });
  }
}
