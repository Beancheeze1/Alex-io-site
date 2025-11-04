// app/api/ai/respond/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RespondInput = {
  toEmail: string;
  subject: string;
  text: string;
  threadId?: string | number;
  dryRun?: boolean;
};

function env(name: string, required = false) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v ?? "";
}

function baseFromReq(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/** Best-effort dimension + qty parser: e.g., "12x8x2 in, qty 50" or "12 x 8 x 2, 50 pcs" etc. */
function parseSpecs(text: string) {
  const out: { L?: number; W?: number; H?: number; QTY?: number; UNIT?: "in" | "mm" } = {};
  const clean = text.toLowerCase();

  // units
  out.UNIT = /mm\b/.test(clean) ? "mm" : "in";

  // dims: 12x8x2, 12 x 8 x 2, 12*8*2
  const mDims = clean.match(/(\d+(?:\.\d+)?)\s*[x\*\-]\s*(\d+(?:\.\d+)?)\s*[x\*\-]\s*(\d+(?:\.\d+)?)/);
  if (mDims) {
    out.L = parseFloat(mDims[1]);
    out.W = parseFloat(mDims[2]);
    out.H = parseFloat(mDims[3]);
  }

  // qty
  const mQty = clean.match(/\b(qty|quantity|pcs|pieces?)\s*[:=]?\s*(\d{1,6})\b/) || clean.match(/\b(\d{1,6})\s*(pcs|pieces?)\b/);
  if (mQty) {
    out.QTY = parseInt(mQty[mQty.length - 2] ?? mQty[2] ?? mQty[1], 10);
  }

  // standalone qty like "make it 50"
  if (!out.QTY) {
    const mSolo = clean.match(/\b(\d{1,6})\b/);
    if (mSolo) out.QTY = parseInt(mSolo[1], 10);
  }

  return out;
}

function mmToIn(n: number) {
  return n / 25.4;
}

/** Simple fallback quote: CI pricing with min charge and a kerf factor. */
function fallbackQuote(spec: { L?: number; W?: number; H?: number; QTY?: number; UNIT?: "in" | "mm" }) {
  const pricePerCI = Number(process.env.FOAM_PRICE_PER_CI ?? 0.0025); // $/cubic inch default
  const kerfWaste = Number(process.env.FOAM_KERF_WASTE_PCT ?? 10) / 100; // 10%
  const minCharge = Number(process.env.FOAM_MIN_CHARGE ?? 25);

  let { L, W, H, QTY, UNIT } = spec;
  if (!L || !W || !H || !QTY) return null;

  if (UNIT === "mm") {
    L = mmToIn(L!);
    W = mmToIn(W!);
    H = mmToIn(H!);
  }

  const ciEach = (L! * W! * H!) * (1 + kerfWaste);
  const unitPrice = Math.max(minCharge / Math.max(QTY!, 1), ciEach * pricePerCI);
  const total = unitPrice * QTY!;
  return { ciEach, unitPrice, total, currency: "USD" as const };
}

async function tryInternalQuote(req: Request, text: string) {
  const SELF = env("NEXT_PUBLIC_BASE_URL") || baseFromReq(req);
  // If you already have an internal price endpoint, plug it here.
  try {
    const r = await fetch(`${SELF}/api/quote/foam`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!j) return null;
    // expected j: { unitPrice, total, currency, notes? }
    if (typeof j.unitPrice === "number" && typeof j.total === "number") return j;
    return null;
  } catch {
    return null;
  }
}

function composeHtml(toEmail: string, subject: string, text: string, quote: any, spec: any) {
  const lines: string[] = [];
  // short, helpful tone; no quoted history
  lines.push(`<p>Thanks for the details — here’s what I have so far:</p>`);
  if (spec?.L && spec?.W && spec?.H && spec?.QTY) {
    lines.push(`<ul><li>Size: ${spec.L} × ${spec.W} × ${spec.H} ${spec.UNIT || "in"}</li><li>Qty: ${spec.QTY}</li></ul>`);
  }

  if (quote) {
    lines.push(`<p><strong>Estimate:</strong></p>`);
    if (quote.ciEach) lines.push(`<div>Billable CI each: ${quote.ciEach.toFixed(1)}</div>`);
    lines.push(`<div>Unit price: ${quote.unitPrice.toFixed(2)} ${quote.currency || "USD"}</div>`);
    lines.push(`<div>Est. total: ${quote.total.toFixed(2)} ${quote.currency || "USD"}</div>`);
  } else {
    lines.push(`<p>I can price this right away — could you confirm dimensions (L × W × H) and quantity, plus units (in or mm)?</p>`);
  }

  // two crisp follow-ups if missing
  const ask: string[] = [];
  if (!spec?.L || !spec?.W || !spec?.H) ask.push("Dimensions (L × W × H)");
  if (!spec?.QTY) ask.push("Quantity");
  if (ask.length) lines.push(`<p>Missing: ${ask.join(", ")}.</p>`);

  lines.push(`<p>— Alex-IO Estimator</p>`);
  return `<div>${lines.join("")}</div>`;
}

export async function POST(req: Request) {
  try {
    const { toEmail, subject, text, threadId, dryRun }: RespondInput = await req.json();

    // Parse specs from text
    const spec = parseSpecs(text || "");

    // Try internal quote first; fallback if not available
    const internal = await tryInternalQuote(req, text || "");
    const fallback = internal || fallbackQuote(spec);

    const replySubject = subject?.startsWith("Re:") ? subject : `Re: ${subject || "your request"}`;
    const html = composeHtml(toEmail, replySubject, text || "", fallback, spec);

    return NextResponse.json({
      ok: true,
      to: toEmail,
      subject: replySubject,
      html,
      threadId: threadId ? String(threadId) : undefined,
      mode: internal ? "ai_with_internal_quote" : (fallback ? "ai_with_fallback_quote" : "ai_questions_only"),
      dryRun: !!dryRun,
    });
  } catch (e: any) {
    console.error("[ai/respond] error", e?.message || String(e));
    return NextResponse.json({ ok: false, error: e?.message || "respond_exception" }, { status: 500 });
  }
}
