// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseEmailQuote } from "@/lib/email/quoteParser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * INPUT
 * {
 *   mode: "ai" | "ai_questions_only",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,
 *   inReplyTo?: string | null,
 *   threadId?: string | number | null,
 *   internetMessageId?: string | null,
 *   dryRun?: boolean
 * }
 */

type OrchestrateInput = {
  mode: "ai" | "ai_questions_only";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  threadId?: string | number | null;
  internetMessageId?: string | null;
  dryRun?: boolean;
};

type QuoteIntent = {
  qty?: number;
  length_in?: number;
  width_in?: number;
  height_in?: number;
  density_lbft3?: number | null;
  material_hint?: string | null;
  thickness_under_in?: number | null;
  cavities?: Array<{ label: string; w?: number; l?: number; d?: number; dia?: number; count: number }>;
};

function isEmail(s: any) {
  return typeof s === "string" && /\S+@\S+\.\S+/.test(s);
}

// --- Keyword helpers ---------------------------------------------------------
const NUM = String.raw`(?:\d+(?:\.\d+)?)`;
const inch = (s?: string) => (s ? Number(s) : undefined);

function pickOverridesFromText(text?: string): Partial<QuoteIntent> {
  if (!text) return {};
  const src = ` ${text} `.toLowerCase();

  // qty / pcs / pieces / units
  const mq = src.match(/\b(?:qty|quantity|pcs?|pieces?|units?)[:\s]*([0-9]{1,5})\b/);

  // density like 1.7#, 1.9#, 2#, 2.2#
  const md = src.match(/\b([1-9](?:\.[05])?)\s*#\b/);

  // bottom/under pad thickness
  const mpad = src.match(new RegExp(`\\b(?:bottom\\s*pad|under\\s*pad|pad\\s*under)[:\\s]*(${NUM})\\b`));

  // material hints
  const mm = src.match(/\b(pe|epe|pu|urethane|zote|polyethylene)\b/);

  // dims “12x9x3” (x or ×) or “l=12 w=9 h=3”
  const mBox =
    src.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b/) ||
    src.match(/\bl\s*[:=]\s*(\d+(?:\.\d+)?)\b.*?\bw\s*[:=]\s*(\d+(?:\.\d+)?)\b.*?\bh\s*[:=]\s*(\d+(?:\.\d+)?)\b/);

  const out: Partial<QuoteIntent> = {};
  if (mq) out.qty = Number(mq[1]);
  if (md) out.density_lbft3 = Number(md[1]);
  if (mpad) out.thickness_under_in = Number(mpad[1]);
  if (mm) out.material_hint = mm[1];

  if (mBox) {
    out.length_in = inch(mBox[1]);
    out.width_in = inch(mBox[2]);
    out.height_in = inch(mBox[3]);
  }
  return out;
}

function mergeIntent(parsed: Partial<QuoteIntent>, overrides: Partial<QuoteIntent>): QuoteIntent {
  return {
    qty: overrides.qty ?? parsed.qty,
    length_in: overrides.length_in ?? parsed.length_in,
    width_in: overrides.width_in ?? parsed.width_in,
    height_in: overrides.height_in ?? parsed.height_in,
    density_lbft3: overrides.density_lbft3 ?? (parsed as any).density_hint ?? null,
    material_hint: overrides.material_hint ?? (parsed as any).material_hint ?? null,
    thickness_under_in: overrides.thickness_under_in ?? (parsed as any).thickness_under_in ?? null,
    cavities: (parsed as any).cavities ?? [],
  };
}

function formatMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function strong(s: string) {
  return `<strong>${s}</strong>`;
}

function buildQuestions(intent: QuoteIntent): string[] {
  const q: string[] = [];
  if (!intent.length_in || !intent.width_in || !intent.height_in) q.push("final outside dimensions (L × W × H)");
  if (!intent.qty) q.push("quantity");
  if (!intent.density_lbft3 && !intent.material_hint) q.push("foam type/density (e.g., PE 1.7#)");
  return q;
}

function computePrice(intent: QuoteIntent) {
  const L = intent.length_in ?? 0;
  const W = intent.width_in ?? 0;
  const H = intent.height_in ?? 0;
  const volCI = L * W * H;
  const density = intent.density_lbft3 ?? 1.7;
  const qty = intent.qty ?? 1;

  if (!(L && W && H && qty)) return null;

  const basePerCI = 0.0019;
  let unit = volCI * basePerCI * (density / 1.7);
  if ((intent.thickness_under_in ?? 0) > 0) unit *= 1.06;
  if (unit < 12) unit = 12;
  const total = unit * qty;

  return { unit_price_usd: Number(unit.toFixed(2)), total_price_usd: Number(total.toFixed(2)) };
}

function renderQuoteHtml(
  toEmail: string,
  subject: string | undefined,
  intent: QuoteIntent,
  price: { unit_price_usd: number; total_price_usd: number } | null,
  missing: string[]
) {
  const lines: string[] = [];
  lines.push(`<p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>`);

  if (price) {
    lines.push(`<p>Here’s a quick price based on what you shared:</p>`);
    lines.push(`<div style="margin:8px 0 12px 0">`);
    lines.push(`<div>${strong("Unit price:")} ${formatMoney(price.unit_price_usd)}/ea</div>`);
    lines.push(`<div>${strong("Total:")} ${formatMoney(price.total_price_usd)}</div>`);
    lines.push(`</div>`);
  } else {
    lines.push(`<p>To lock in pricing, could you confirm:</p>`);
    lines.push(`<ul style="margin:0 0 12px 18px;padding:0">${missing.map(m => `<li>${m}</li>`).join("")}</ul>`);
  }

  lines.push(`<p>If you have a sketch or photo, attach it—it helps confirm cavity sizes and clearances.</p>`);
  lines.push(`<p style="margin-top:16px">— Alex-IO Estimator</p>`);
  return `<div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">${lines.join(
    "\n"
  )}</div>`;
}

// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/ai/orchestrate" });
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const SEND_URL = process.env.INTERNAL_SEND_URL || new URL("/api/msgraph/send", url).toString();

    const body = (await req.json().catch(() => ({}))) as OrchestrateInput;
    if (body?.mode !== "ai" && body?.mode !== "ai_questions_only") {
      return NextResponse.json({ ok: false, error: "mode_must_be_ai" }, { status: 400 });
    }
    if (!isEmail(body?.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid_toEmail" }, { status: 400 });
    }

    const text = body?.text ?? "";
    const parsed = parseEmailQuote(text || "");                                  // existing parser
    const overrides = pickOverridesFromText([body.subject, text].filter(Boolean).join("\n")); // keywords
    const intent = mergeIntent(parsed as any, overrides);                        // merged result

    const missing = buildQuestions(intent);
    const canPrice = missing.length === 0 && body.mode === "ai";
    const price = canPrice ? computePrice(intent) : null;

    const subject = body?.subject || "Re: foam quote";
    const html = renderQuoteHtml(body.toEmail, subject, intent, price, missing);

    // --------- DRY RUN: now returns merged intent + debug --------------------
    if (body?.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        to: body.toEmail,
        subject,
        htmlPreview: html,
        intent,                         // <— merged, what will be used for pricing
        missingDetected: missing,
        debug: {
          overridesApplied: overrides,  // what keywords provided/overrode
          parsedBase: parsed            // raw parser output before overrides
        }
      });
    }

    // questions-only mode: preview only
    if (body.mode === "ai_questions_only") {
      return NextResponse.json({
        ok: true,
        ai: { mode: "ai_questions_only" },
        htmlPreview: html,
        intent,
        missingDetected: missing
      });
    }

    // Live send via Graph
    const payload = {
      to: body.toEmail,
      subject,
      html,
      inReplyTo: body.inReplyTo ?? null,
      threadId: body.threadId ?? null,
      internetMessageId: body.internetMessageId ?? null,
    };

    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "send_failed", detail, status: res.status },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      to: body.toEmail,
      subject,
      graph: { status: res.status, route: "/api/msgraph/send", note: "live" },
      intent,
      missingDetected: missing
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "orchestrate_exception" },
      { status: 500 }
    );
  }
}
