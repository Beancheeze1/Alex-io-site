// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrchestrateInput = {
  mode?: "ai";
  toEmail?: string;
  subject?: string;
  text?: string;
  inReplyTo?: string;
  dryRun?: boolean;
  ai?: { task?: string; hints?: string[] };
  hubspot?: { objectId?: string };
};

function s(x: unknown): string { return typeof x === "string" ? x : x == null ? "" : String(x); }
function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// ---- UPDATED: broader, punctuation-tolerant quantity matcher
function parseSlots(raw: string) {
  const LWH =
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(raw) ||
    /\bL\s*[:=]?\s*(\d+(?:\.\d+)?)\b.*\bW\s*[:=]?\s*(\d+(?:\.\d+)?)\b.*\bH\s*[:=]?\s*(\d+(?:\.\d+)?)/i.exec(raw);

  // Accept: quantity 25, qty 25, q:25, pcs 25, pieces 25, units 25, with optional colon/equals/comma
  const qty =
    /\b(?:quantity|qty|q|pcs|pieces?|units?)\b\s*[:=]?\s*,?\s*(\d{1,6})\b/i.exec(raw);

  // Density and “under pad” thickness unchanged
  const dens = /\b(\d(?:\.\d+)?)\s*(?:lb\/?ft3|lb\/?ft\^?3|density)\b/i.exec(raw);
  const under = /\b(?:under|bottom|pad)\s*(\d(?:\.\d+)?)\s*(?:in|inch|")\b/i.exec(raw);

  const slots: any = {};
  if (LWH) {
    slots.internal_length_in = Number(LWH[1]);
    slots.internal_width_in  = Number(LWH[2]);
    slots.internal_height_in = Number(LWH[3]);
  }
  if (qty) { slots.qty = Number(qty[1]); }
  if (dens) { slots.density_lbft3 = Number(dens[1]); }
  if (under) { slots.thickness_under_in = Number(under[1]); }

  return slots;
}

function buildReplyHtml(missing: string[], price?: { unitPrice: number; total: number }) {
  const currency = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  const priceBlock = price
    ? `<p>Here’s a quick price based on what you shared:</p>
       <div style="margin:8px 0 12px 0">
         <div><strong>Unit price</strong> ${currency(price.unitPrice)}</div>
         <div><strong>Total</strong> ${currency(price.total)}</div>
       </div>`
    : "";

  const ask =
    missing.length > 0
      ? `To lock in pricing, could you confirm:<ul style="margin:0 0 12px 18px;padding:0">${missing
          .slice(0, 4)
          .map((m) => `<li>${m}</li>`)
          .join("")}</ul>`
      : "If you have a sketch or photo, feel free to attach it — that helps confirm cavity placement and edge clearances.";

  return `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    ${priceBlock}
    <p>${ask}</p>
    <p style="margin-top:16px">— Alex-IO Estimator</p>
  </div>`.trim();
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/ai/orchestrate" });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as OrchestrateInput;

    const url = new URL(req.url);
    const SELF = process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;

    const toEmail = s(body.toEmail);
    if (!isEmail(toEmail)) return NextResponse.json({ ok: false, error: "invalid_toEmail" }, { status: 400 });

    const subject = s(body.subject) || "Re: your message to Alex-IO";
    const raw = s(body.text);

    const slots = parseSlots(raw);

    // defaults
    if (slots.thickness_under_in == null) slots.thickness_under_in = Number(process.env.DEFAULT_UNDER_IN ?? "0.5");
    if (slots.cavities == null) slots.cavities = 1;

    // ---- UPDATED: treat qty <= 0 as missing
    const missing: string[] = [];
    if (slots.internal_length_in == null || slots.internal_width_in == null || slots.internal_height_in == null) {
      missing.push("final outside dimensions (L × W × H)");
    }
    if (!Number.isFinite(slots.qty) || slots.qty <= 0) missing.push("quantity");
    if (slots.thickness_under_in == null) missing.push("thickness under the part");

    let priced: { unitPrice: number; total: number } | undefined;
    if (missing.length === 0) {
      const priceRes = await fetch(`${SELF}/api/ai/price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots }),
      });
      const pj = await priceRes.json().catch(() => ({}));
      if (priceRes.ok && pj?.ok && Number.isFinite(pj.unitPrice) && Number.isFinite(pj.total)) {
        priced = { unitPrice: pj.unitPrice, total: pj.total };
      }
    }

    const kv = makeKv();
    const kvKey = `alexio:mid:${toEmail.toLowerCase()}`;
    let inReplyTo = s(body.inReplyTo);
    if (!inReplyTo) {
      const fallbackMid = await kv.get(kvKey).catch(() => null);
      if (fallbackMid) inReplyTo = String(fallbackMid);
    }

    const html = buildReplyHtml(missing, priced);

    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        to: toEmail,
        subject,
        htmlPreview: html,
        missingDetected: missing,
        inReplyTo: inReplyTo || null,
      });
    }

    const res = await fetch(`${SELF}/api/msgraph/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: toEmail, subject, html, inReplyTo: inReplyTo || undefined }),
    });
    const sendJson = await res.json().catch(() => ({}));
    if (!res.ok || sendJson?.ok === false) {
      return NextResponse.json(
        { ok: false, error: "graph_send_failed", status: res.status, detail: sendJson?.error ?? sendJson },
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
      usedInReplyTo: inReplyTo || null,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "orchestrate_exception" }, { status: 500 });
  }
}
