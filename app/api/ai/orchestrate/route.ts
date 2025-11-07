// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pickTopMaterial } from "@/app/lib/ai/materialSelect";

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

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- origin helpers (CF/Render safe) ----
function getOrigin(req: NextRequest) {
  const xfProto = req.headers.get("x-forwarded-proto") || undefined;
  const xfHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    undefined;
  const proto = xfProto || "https";
  if (!xfHost) {
    try {
      const u = new URL(req.url);
      return `${proto}://${u.hostname}`;
    } catch {
      return `${proto}://api.alex-io.com`;
    }
  }
  return `${proto}://${xfHost}`;
}
function local(req: NextRequest, path: string) {
  const base = getOrigin(req);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

// Minimal pretty item for display
type PrettyItem = {
  id: string | number | null;
  name: string | null;
  density_pcf: number | null;
  color: string | null;
  price_per_bf: number | null;
  price_per_ci: number | null;
  min_charge: number | null;
  kerf_pct?: number | null;
  vendor?: string | null;
};

// ---- simple preliminary pricing (per piece, then extended) ----
type PricingOut = {
  materialName: string;
  rateBasis: "CI" | "BF->CI";
  ratePerCI: number;       // USD per cubic inch
  kerf_pct: number;        // 0..100
  min_charge: number;      // USD per piece
  qty: number;
  dims_ci: number;         // L*W*H (in^3)
  piece_ci_with_waste: number;
  each: number;            // max(min_charge, ratePerCI * piece_ci_with_waste)
  extended: number;        // each * qty
  notes?: string;
};

function ciFromBF(bf: number) {
  // 1 board foot = 144 in^3
  return bf / 144;
}
function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function computePrelimPricing(extracted: any, top: any): PricingOut | null {
  if (!extracted?.dims || typeof extracted.qty === "undefined") return null;
  const L = toNum(extracted.dims.L_in);
  const W = toNum(extracted.dims.W_in);
  const H = toNum(extracted.dims.H_in);
  const qty = toNum(extracted.qty);
  if (!L || !W || !H || !qty) return null;

  const pricePerCI = toNum(top?.price_per_ci);
  const pricePerBF = toNum(top?.price_per_bf);
  let ratePerCI: number | null = null;
  let basis: "CI" | "BF->CI" = "CI";

  if (pricePerCI != null) {
    ratePerCI = pricePerCI;
    basis = "CI";
  } else if (pricePerBF != null) {
    ratePerCI = pricePerBF / 144;
    basis = "BF->CI";
  } else {
    return null; // no rate available
  }

  const kerf_pct_raw = toNum(top?.kerf_pct) ?? 0;     // e.g., 10 means 10%
  const min_charge = toNum(top?.min_charge) ?? 0;

  const dims_ci = L * W * H;                          // simple block volume
  const piece_ci_with_waste = dims_ci * (1 + kerf_pct_raw / 100);
  const rawEach = ratePerCI * piece_ci_with_waste;
  const each = Math.max(min_charge, rawEach);
  const extended = each * qty;

  return {
    materialName: String(top?.name ?? "Material"),
    rateBasis: basis,
    ratePerCI: ratePerCI!,
    kerf_pct: kerf_pct_raw,
    min_charge,
    qty,
    dims_ci,
    piece_ci_with_waste,
    each,
    extended,
  };
}

export async function POST(req: NextRequest) {
  const diag: Record<string, any> = {};
  try {
    const body = (await req.json()) as Partial<OrchestrateInput>;
    const input: OrchestrateInput = {
      mode: "ai",
      toEmail: s(body.toEmail),
      subject: s(body.subject || "Re: your message"),
      text: s(body.text),
      inReplyTo: body.inReplyTo ?? null,
      dryRun: !!body.dryRun,
      sketchRefs: Array.isArray(body.sketchRefs)
        ? body.sketchRefs.filter((x) => s(x).length > 0)
        : [],
    };
    if (!isEmail(input.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    // 1) Extract
    let extracted: any = null;
    let missing: string[] | null = null;
    try {
      const extractUrl = local(req, "/api/ai/extract");
      diag.extract_url = extractUrl;
      const exRes = await fetch(extractUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ text: input.text }),
      });
      diag.extract_status = exRes.status;
      if (!exRes.ok) {
        diag.extract_error = await safeText(exRes);
      } else {
        const j = await exRes.json();
        extracted = j?.extracted ?? null;
        missing = j?.missing ?? null;
        diag.extract_ok = true;
      }
    } catch (e: any) {
      diag.extract_throw = e?.message || String(e);
    }

    // 2) Suggest materials
    let suggested: {
      count: number;
      items: any[];
      itemsPretty?: PrettyItem[];
      summary?: string;
      top: any | null;
    } = { count: 0, items: [], top: null };

    try {
      const hasHints =
        (extracted && extracted.dbFilter && Object.keys(extracted.dbFilter).length > 0) ||
        (extracted && Array.isArray(extracted.searchWords) && extracted.searchWords.length > 0);

      diag.hasHints = !!hasHints;
      if (hasHints) {
        const sugUrl = local(req, "/api/ai/suggest-materials");
        diag.suggest_url = sugUrl;
        const payload = {
          filter: extracted?.dbFilter ?? {},
          searchWords: extracted?.searchWords ?? [],
        };
        diag.suggest_payload = payload;

        const sRes = await fetch(sugUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(payload),
        });
        diag.suggest_status = sRes.status;

        if (!sRes.ok) {
          diag.suggest_error = await safeText(sRes);
        } else {
          const j = await sRes.json();
          const items = Array.isArray(j?.items) ? j.items : [];
          suggested.items = items;
          suggested.count = Number(j?.count ?? items.length);
          suggested.top = pickTopMaterial(items, extracted ?? null);

          const pretty: PrettyItem[] = items.slice(0, 8).map((it: any): PrettyItem => ({
            id: it?.id ?? null,
            name: it?.name ?? null,
            density_pcf: toNum(it?.density_pcf),
            color: it?.color ?? null,
            price_per_bf: toNum(it?.price_per_bf),
            price_per_ci: toNum(it?.price_per_ci),
            min_charge: toNum(it?.min_charge),
            kerf_pct: toNum(it?.kerf_pct),
            vendor: it?.vendor ?? null,
          }));
          suggested.itemsPretty = pretty;

          suggested.summary =
            pretty.length > 0
              ? pretty
                  .map((it: PrettyItem) => {
                    const parts: string[] = [];
                    parts.push(it.name ?? "Material");
                    if (it.density_pcf != null) parts.push(`${it.density_pcf.toFixed(1)} pcf`);
                    if (it.color) parts.push(it.color);
                    if (it.price_per_bf != null) parts.push(`$${it.price_per_bf}/BF`);
                    else if (it.price_per_ci != null) parts.push(`$${it.price_per_ci}/CI`);
                    return "• " + parts.join(" — ");
                  })
                  .join("\n")
              : "None";
          diag.suggest_ok = true;
        }
      }
    } catch (e: any) {
      diag.suggest_throw = e?.message || String(e);
    }

    // 3) Quote HTML (base)
    let quotePayload: any = null;
    let html: string | null = null;
    try {
      const quoteUrl = local(req, "/api/ai/quote");
      diag.quote_url = quoteUrl;
      const qRes = await fetch(quoteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ text: input.text }),
      });
      diag.quote_status = qRes.status;
      if (!qRes.ok) {
        diag.quote_error = await safeText(qRes);
      } else {
        const j = await qRes.json();
        quotePayload = j ?? null;
        html = j?.html ?? null;
        diag.quote_ok = true;
      }
    } catch (e: any) {
      diag.quote_throw = e?.message || String(e);
    }

    if (!html) {
      html = `
        <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
          <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
          <p>To lock in pricing, could you confirm (or attach a sketch):</p>
          <ul style="margin:0 0 12px 18px">
            <li>final outside dimensions (L × W × H)</li>
            <li>quantity</li>
            <li>foam density (e.g., 1.7 pcf)</li>
            <li>thickness under the part</li>
            <li>units (in or mm)</li>
          </ul>
          <p>— Alex-IO Estimator</p>
        </div>
      `.trim();
      diag.html_fallback = true;
    }

    // 4) Preliminary pricing (only if we have enough data)
    let pricing: PricingOut | null = null;
    if (suggested.top) {
      pricing = computePrelimPricing(extracted, suggested.top);
    }

    if (pricing) {
      const block = `
        <div style="margin-top:16px">
          <h3 style="margin:0 0 6px 0">Pricing (preliminary)</h3>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px">
            <tr>
              <td style="padding:6px 8px;color:#555">Material</td>
              <td style="padding:6px 8px;text-align:right;color:#111"><strong>${escapeHtml(
                pricing.materialName
              )}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 8px;color:#555">Rate</td>
              <td style="padding:6px 8px;text-align:right;color:#111">${pricing.rateBasis === "CI"
                ? `${money(pricing.ratePerCI)}/CI`
                : `${money(pricing.ratePerCI * 144)}/BF (${money(pricing.ratePerCI)}/CI)`}</td>
            </tr>
            <tr>
              <td style="padding:6px 8px;color:#555">Waste (kerf)</td>
              <td style="padding:6px 8px;text-align:right;color:#111">${pricing.kerf_pct.toFixed(1)}%</td>
            </tr>
            <tr>
              <td style="padding:6px 8px;color:#555">Min charge each</td>
              <td style="padding:6px 8px;text-align:right;color:#111">${money(pricing.min_charge)}</td>
            </tr>
            <tr>
              <td style="padding:6px 8px;color:#555">Unit size (in³)</td>
              <td style="padding:6px 8px;text-align:right;color:#111">${pricing.dims_ci.toFixed(1)} → ${pricing.piece_ci_with_waste.toFixed(1)} w/ waste</td>
            </tr>
            <tr>
              <td style="padding:6px 8px;color:#555">Qty</td>
              <td style="padding:6px 8px;text-align:right;color:#111">${pricing.qty}</td>
            </tr>
            <tr>
              <td style="padding:6px 8px;color:#555">Price each</td>
              <td style="padding:6px 8px;text-align:right;color:#111"><strong>${money(pricing.each)}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 8px;color:#555">Extended</td>
              <td style="padding:6px 8px;text-align:right;color:#111"><strong>${money(pricing.extended)}</strong></td>
            </tr>
          </table>
          <p style="margin:8px 0 0 0;color:#666;font-size:12px">Note: preliminary estimate based on top matched material and simple block volume; final price may change with cavities, draw, and tolerances.</p>
        </div>
      `.trim();

      html += block;
    }

    // Also append a small suggestions block in dryRun for eyeballing
    if (input.dryRun && suggested.itemsPretty && suggested.itemsPretty.length) {
      const list = (suggested.itemsPretty as PrettyItem[])
        .slice(0, 3)
        .map((it: PrettyItem) => {
          const bits: string[] = [];
          bits.push(it.name ?? "Material");
          if (it.density_pcf != null) bits.push(`${it.density_pcf.toFixed(1)} pcf`);
          if (it.color) bits.push(it.color);
          if (it.price_per_bf != null) bits.push(`$${it.price_per_bf}/BF`);
          else if (it.price_per_ci != null) bits.push(`$${it.price_per_ci}/CI`);
          return `<li>${bits.join(" — ")}</li>`;
        })
        .join("");

      html += `
        <div style="margin-top:16px">
          <p style="margin:0 0 6px 0"><strong>Suggested materials (top ${Math.min(
            3,
            suggested.itemsPretty.length
          )}):</strong></p>
          <ul style="margin:0 0 12px 18px">${list}</ul>
        </div>
      `;
    }

    // DryRun response
    if (input.dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          to: input.toEmail,
          subject: input.subject,
          htmlPreview: html,
          quote: quotePayload?.quote ?? null,
          extracted,
          missing,
          suggested,
          pricing,  // NEW: structured pricing in the JSON
          diag,
        },
        { status: 200 }
      );
    }

    // Live send
    const sendUrl = local(req, "/api/msgraph/send");
    diag.send_url = sendUrl;
    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        mode: "reply",
        to: input.toEmail,
        subject: input.subject,
        html,
        inReplyTo: input.inReplyTo ?? null,
      }),
    });
    const forwarded = await sendRes.json().catch(() => ({}));

    return NextResponse.json(
      {
        ok: sendRes.ok,
        status: sendRes.status,
        forwardedPath: "/api/msgraph/send",
        result: forwarded,
        quote: quotePayload?.quote ?? null,
        extracted,
        missing,
        suggested,
        pricing,
        diag,
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

// utils
async function safeText(res: Response, max = 300) {
  try {
    const t = await res.text();
    return t.length > max ? t.slice(0, max) + "…(truncated)" : t;
  } catch {
    return "<no-text>";
  }
}
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
