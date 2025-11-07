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

// ---- origin helpers ----
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

// ------------ Units normalization helpers ------------
function normalizeDimsToInches(extracted: any): { L: number; W: number; H: number } | null {
  if (!extracted?.dims) return null;

  // Accept any of these shapes:
  // { L_in, W_in, H_in }, { L, W, H, units }, { L_mm, W_mm, H_mm }, or explicit extracted.units == 'mm'
  const d = extracted.dims;
  let L = toNum(d?.L_in ?? d?.L);
  let W = toNum(d?.W_in ?? d?.W);
  let H = toNum(d?.H_in ?? d?.H);

  const units =
    d?.units ||
    extracted?.units ||
    (d?.L_mm || d?.W_mm || d?.H_mm ? "mm" : "in");

  if (units === "mm") {
    if (toNum(d?.L_mm) && toNum(d?.W_mm) && toNum(d?.H_mm)) {
      L = toNum(d?.L_mm)! / 25.4;
      W = toNum(d?.W_mm)! / 25.4;
      H = toNum(d?.H_mm)! / 25.4;
    } else if (L && W && H) {
      L = L / 25.4;
      W = W / 25.4;
      H = H / 25.4;
    }
  }

  if (!L || !W || !H) return null;
  return { L, W, H };
}

// ------------ Simple CI fallback pricing ------------
type PricingOut = {
  materialName: string;
  rateBasis: "CI" | "BF->CI";
  ratePerCI: number;
  kerf_pct: number;
  min_charge: number;
  qty: number;
  dims_ci: number;
  piece_ci_with_waste: number;
  each: number;
  extended: number;
  notes?: string;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function computePrelimPricing(
  qty: number,
  L: number,
  W: number,
  H: number,
  top: any
): PricingOut | null {
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
    return null;
  }

  const kerf_pct_raw = toNum(top?.kerf_pct) ?? 0;
  const min_charge = toNum(top?.min_charge) ?? 0;

  const dims_ci = L * W * H;
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
        diag.extract_error = await exRes.text().catch(() => "<no-text>");
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
          diag.suggest_error = await sRes.text().catch(() => "<no-text>");
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
        diag.quote_error = await qRes.text().catch(() => "<no-text>");
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

    // 4) DB price (with mm→in normalization)
    let pricingBlockHtml = "";
    let pricingDiag: any = {};
    let pricingUsedDb = false;

    const qty = toNum(extracted?.qty);
    const dimsInches = normalizeDimsToInches(extracted);
    const top = suggested.top;

    if (qty && dimsInches && top?.id != null) {
      try {
        const priceUrl = local(req, "/api/ai/price");
        const pRes = await fetch(priceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            dims: { L: dimsInches.L, W: dimsInches.W, H: dimsInches.H, units: "in" },
            qty,
            materialId: Number(top.id),
            cavities: 0,
            round_to_bf: false,
          }),
        });
        pricingDiag.price_status = pRes.status;
        if (pRes.ok) {
          const pj = await pRes.json();
          if (pj?.ok) {
            pricingUsedDb = true;
            pricingBlockHtml = `
              <div style="margin-top:16px">
                <h3 style="margin:0 0 6px 0">Pricing (preliminary — DB)</h3>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px">
                  <tr><td style="padding:6px 8px;color:#555">Material</td><td style="padding:6px 8px;text-align:right;color:#111"><strong>${escapeHtml(String(top?.name ?? "Material"))}</strong></td></tr>
                  <tr><td style="padding:6px 8px;color:#555">Dims (in)</td><td style="padding:6px 8px;text-align:right;color:#111">${dimsInches.L.toFixed(2)} × ${dimsInches.W.toFixed(2)} × ${dimsInches.H.toFixed(2)}</td></tr>
                  <tr><td style="padding:6px 8px;color:#555">Qty</td><td style="padding:6px 8px;text-align:right;color:#111">${qty}</td></tr>
                  <tr><td style="padding:6px 8px;color:#555">Price each</td><td style="padding:6px 8px;text-align:right;color:#111"><strong>${money(pj.each)}</strong></td></tr>
                  <tr><td style="padding:6px 8px;color:#555">Extended</td><td style="padding:6px 8px;text-align:right;color:#111"><strong>${money(pj.extended)}</strong></td></tr>
                </table>
                <p style="margin:8px 0 0 0;color:#666;font-size:12px">Note: DB function result (<code>calc_foam_quote</code>).</p>
              </div>
            `;
          } else {
            pricingDiag.price_error = pj?.error ?? "unknown db price error";
          }
        } else {
          pricingDiag.price_error_text = await pRes.text().catch(() => "<no-text>");
        }
      } catch (e: any) {
        pricingDiag.price_throw = e?.message || String(e);
      }
    }

    // 5) Fallback CI math if DB price not available
    if (!pricingUsedDb && qty && dimsInches && top) {
      const p = computePrelimPricing(qty, dimsInches.L, dimsInches.W, dimsInches.H, top);
      if (p) {
        pricingBlockHtml = `
          <div style="margin-top:16px">
            <h3 style="margin:0 0 6px 0">Pricing (preliminary)</h3>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px">
              <tr><td style="padding:6px 8px;color:#555">Material</td><td style="padding:6px 8px;text-align:right;color:#111"><strong>${escapeHtml(p.materialName)}</strong></td></tr>
              <tr><td style="padding:6px 8px;color:#555">Dims (in)</td><td style="padding:6px 8px;text-align:right;color:#111">${dimsInches.L.toFixed(2)} × ${dimsInches.W.toFixed(2)} × ${dimsInches.H.toFixed(2)}</td></tr>
              <tr><td style="padding:6px 8px;color:#555">Qty</td><td style="padding:6px 8px;text-align:right;color:#111">${p.qty}</td></tr>
              <tr><td style="padding:6px 8px;color:#555">Rate</td><td style="padding:6px 8px;text-align:right;color:#111">${p.rateBasis === "CI" ? `${money(p.ratePerCI)}/CI` : `${money(p.ratePerCI * 144)}/BF (${money(p.ratePerCI)}/CI)`}</td></tr>
              <tr><td style="padding:6px 8px;color:#555">Waste (kerf)</td><td style="padding:6px 8px;text-align:right;color:#111">${p.kerf_pct.toFixed(1)}%</td></tr>
              <tr><td style="padding:6px 8px;color:#555">Min charge each</td><td style="padding:6px 8px;text-align:right;color:#111">${money(p.min_charge)}</td></tr>
              <tr><td style="padding:6px 8px;color:#555">Unit size (in³)</td><td style="padding:6px 8px;text-align:right;color:#111">${p.dims_ci.toFixed(1)} → ${p.piece_ci_with_waste.toFixed(1)} w/ waste</td></tr>
              <tr><td style="padding:6px 8px;color:#555">Price each</td><td style="padding:6px 8px;text-align:right;color:#111"><strong>${money(p.each)}</strong></td></tr>
              <tr><td style="padding:6px 8px;color:#555">Extended</td><td style="padding:6px 8px;text-align:right;color:#111"><strong>${money(p.extended)}</strong></td></tr>
            </table>
            <p style="margin:8px 0 0 0;color:#666;font-size:12px">Note: simple CI estimate; final price may change with cavities/tolerances.</p>
          </div>
        `;
      }
    }

    // Append pricing block (if any)
    if (pricingBlockHtml) html += pricingBlockHtml;

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

    // DryRun
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
          diag: { ...diag, pricingDiag, pricingUsedDb },
        },
        { status: 200 }
      );
    }

    // Live send via Graph
    const sendUrl = local(req, "/api/msgraph/send");
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
        diag: { ...diag, pricingDiag, pricingUsedDb },
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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
