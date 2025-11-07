// app/api/ai/quote/route.ts
import { NextRequest, NextResponse } from "next/server";
import { extractSpecs } from "@/app/lib/ai/extract";
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";
import { absoluteUrl } from "@/app/lib/internalFetch"; // <-- use same helper as orchestrator

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteInput = {
  text: string;
  customerLine?: string;
  sketchRefs?: string[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<QuoteInput>;
    const raw = String(body?.text ?? "");
    const extracted = extractSpecs(raw);

    const missing: string[] = [];
    if (!extracted.dims) missing.push("final outside dimensions (L × W × H)");
    if (!extracted.qty) missing.push("quantity");
    if (!extracted.density_pcf) missing.push("foam density (e.g., 1.7 pcf)");
    if (extracted.thickness_under_in == null) missing.push("thickness under the part");
    if (!extracted.unitsMentioned) missing.push("units (in or mm)");

    let material: any = null;
    let ci = { piece_ci: 0, order_ci: 0, order_ci_with_waste: 0 };
    let pricing = { raw: 0, total: 0, used_min_charge: false };

    // only price when we have enough signals
    if (extracted.dims && extracted.qty && extracted.density_pcf && extracted.unitsMentioned) {
      try {
        const priceUrl = absoluteUrl(req, "/api/ai/price"); // <-- switch to absoluteUrl()
        const res = await fetch(priceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            slots: {
              internal_length_in: extracted.dims.L_in,
              internal_width_in:  extracted.dims.W_in,
              internal_height_in: extracted.dims.H_in,
              thickness_under_in: extracted.thickness_under_in ?? 0,
              qty: extracted.qty!,
              density_lbft3: extracted.density_pcf!, // numeric equivalent
              cavities: [],
            }
          })
        });

        if (res.ok) {
          const j = await res.json();
          if (j?.ok) {
            material = j.material ?? null;
            ci = {
              piece_ci: j.ci?.piece_ci ?? 0,
              order_ci: j.ci?.order_ci ?? 0,
              order_ci_with_waste: j.ci?.order_ci_with_waste ?? 0,
            };
            pricing = {
              raw: j.pricing?.raw ?? 0,
              total: j.pricing?.total ?? 0,
              used_min_charge: !!j.pricing?.used_min_charge,
            };
          } else {
            // surface upstream error in a safe way
            missing.push("pricing temporarily unavailable");
          }
        } else {
          missing.push("pricing temporarily unavailable");
        }
      } catch (err:any) {
        // keep the API resilient if self-fetch fails
        missing.push("pricing temporarily unavailable");
      }
    }

    const html = renderQuoteEmail({
      customerLine: body.customerLine,
      specs: {
        L_in: extracted.dims?.L_in ?? 0,
        W_in: extracted.dims?.W_in ?? 0,
        H_in: extracted.dims?.H_in ?? 0,
        thickness_under_in: extracted.thickness_under_in ?? null,
        qty: extracted.qty ?? 0,
        density_pcf: extracted.density_pcf ?? null,
        foam_family: extracted.foam_family ?? null,
        color: extracted.color ?? null,
      },
      material,
      pricing: {
        piece_ci: ci.piece_ci,
        order_ci: ci.order_ci,
        order_ci_with_waste: ci.order_ci_with_waste,
        raw: pricing.raw,
        total: pricing.total,
        used_min_charge: pricing.used_min_charge,
      },
      missing,
    });

    const quote = {
      specs: extracted,
      material,
      ci,
      pricing,
      missing,
    };

    return NextResponse.json({ ok: true, quote, html }, { status: 200 });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || "ai/quote error" }, { status:500 });
  }
}
