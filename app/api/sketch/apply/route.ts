// app/api/sketch/apply/route.ts
//
// Auto-quote from a parsed sketch.
// Called after a file has been uploaded + parsed by /api/sketch/parse.
//
// POST JSON:
//   {
//     "quote_no": "Q-AI-20251116-223023",
//     "attachmentId": 6,
//     "parsed": { ... ParsedSketch ... }
//   }
//
// Behaviour:
//   - Looks up the quote header + first quote item
//   - Merges in dims / cavities from `parsed` (vision)
//   - Calls /api/quotes/calc to get pricing
//   - Uses renderQuoteEmail to build an updated email
//   - Sends email via /api/msgraph/send
//
// If the quote row has no email, we fall back to NEXT_PUBLIC_SALES_FORWARD_TO
// (your sales inbox) instead of throwing an error.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ParsedSketch = {
  dims?: string | null;
  qty?: number | null;
  material?: string | null;
  density?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[] | null;
  notes?: string | null;
};

type ApplyInput = {
  quote_no?: string | null;
  attachmentId?: number | null;
  parsed?: ParsedSketch | null;
};

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  status: string;
};

type QuoteItemRow = {
  length_in: number;
  width_in: number;
  height_in: number;
  material_id: number;
  qty: number;
};

type MaterialRow = {
  id: number;
  name: string | null;
  density_lb_ft3: number | null;
  kerf_pct: number | null;
  min_charge: number | null;
};

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

function parseDims(dims: string | null | undefined) {
  const parts = String(dims || "")
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/×/g, "x")
    .split("x")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));

  return {
    L: parts[0] || 0,
    W: parts[1] || 0,
    H: parts[2] || 0
  };
}

function densityToPcf(density: string | null | undefined): number | null {
  const m = String(density || "").match(/(\d+(\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

async function calcQuoteCI(opts: {
  dims: string;
  qty: number;
  material_id: number;
  cavities: string[];
}) {
  const [L, W, H] = String(opts.dims)
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/×/g, "x")
    .split("x")
    .map((s) => Number(s.trim()));

  const base =
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      length_in: L,
      width_in: W,
      height_in: H,
      material_id: opts.material_id,
      qty: opts.qty,
      cavities: opts.cavities || [],
      round_to_bf: false
    })
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j.ok) return null;
  return j.result;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ApplyInput;
    const quoteNo = (body.quote_no || "").trim();
    const parsed = body.parsed || {};
    const attachmentId = body.attachmentId || null;

    if (!quoteNo) {
      return err("missing_quote_no", "quote_no is required");
    }

    // 1) Load quote header
    const quote = await one<QuoteRow>(
      `
      SELECT id, quote_no, customer_name, email, phone, status
      FROM quotes
      WHERE quote_no = $1
      LIMIT 1;
      `,
      [quoteNo]
    );

    if (!quote) {
      return err("quote_not_found", { quoteNo }, 404);
    }

    // Decide where to send the auto-quote email.
    // Prefer the quote's email; fall back to sales inbox if missing.
    let toEmail: string | null = quote.email;
    if (!toEmail) {
      const fallbackSales =
        process.env.NEXT_PUBLIC_SALES_FORWARD_TO ||
        process.env.NEXT_PUBLIC_FALLBACK_QUOTE_EMAIL ||
        "";

      if (!fallbackSales) {
        // No customer email AND no configured fallback -> we can't send.
        return err("quote_missing_email", { quoteNo }, 500);
      }

      toEmail = fallbackSales;
    }

    // 2) Load primary quote item
    const item = await one<QuoteItemRow>(
      `
      SELECT length_in, width_in, height_in, material_id, qty
      FROM quote_items
      WHERE quote_id = $1
      ORDER BY id ASC
      LIMIT 1;
      `,
      [quote.id]
    );

    if (!item) {
      return err("quote_item_not_found", { quoteId: quote.id }, 404);
    }

    // 3) Load material info
    const material = await one<MaterialRow>(
      `
      SELECT
        id,
        name,
        density_lb_ft3,
        kerf_waste_pct AS kerf_pct,
        min_charge_usd AS min_charge
      FROM materials
      WHERE id = $1
      LIMIT 1;
      `,
      [item.material_id]
    );

    if (!material) {
      return err("material_not_found", { material_id: item.material_id }, 404);
    }

    // 4) Merge dims / qty / cavities from parsed sketch + existing item
    const baseDims = `${item.length_in}x${item.width_in}x${item.height_in}`;
    const mergedDims =
      parsed.dims && parsed.dims.trim() ? parsed.dims.trim() : baseDims;

    const mergedQty =
      parsed.qty && parsed.qty > 0 ? parsed.qty : item.qty;

    const cavities =
      Array.isArray(parsed.cavityDims) && parsed.cavityDims.length > 0
        ? parsed.cavityDims
        : [];

    // 5) Re-run calc using merged dims / qty / cavities
    const calc = await calcQuoteCI({
      dims: mergedDims,
      qty: mergedQty,
      material_id: item.material_id,
      cavities
    });

    if (!calc) {
      return err("calc_failed", { quoteId: quote.id }, 500);
    }

    // 6) Build email using the main template
    const { L, W, H } = parseDims(mergedDims);
    const densityPcf =
      parsed.density != null
        ? densityToPcf(parsed.density)
        : material.density_lb_ft3;

    const templateInput = {
      customerLine:
        "Thanks for the sketch—here’s an updated quote using your drawing.",
      quoteNumber: quote.quote_no,
      specs: {
        L_in: L,
        W_in: W,
        H_in: H,
        qty: mergedQty,
        density_pcf: densityPcf ?? null,
        foam_family: material.name,
        thickness_under_in: null,
        color: null
      },
      material: {
        name: material.name,
        density_lbft3: material.density_lb_ft3,
        kerf_pct: material.kerf_pct,
        min_charge: material.min_charge
      },
      pricing: {
        total:
          calc.price_total ??
          calc.total ??
          calc.order_total ??
          0,
        piece_ci: calc.piece_ci ?? null,
        order_ci: calc.order_ci ?? null,
        order_ci_with_waste: calc.order_ci_with_waste ?? null,
        used_min_charge: calc.min_charge_applied ?? null
      },
      missing: [] as string[],
      facts: {
        quoteId: quote.id,
        quote_no: quote.quote_no,
        from: "sketch-auto-quote",
        attachmentId,
        sketchParsed: parsed
      }
    };

    let htmlBody = "";
    try {
      htmlBody = renderQuoteEmail(templateInput);
    } catch (e) {
      console.error("renderQuoteEmail failed in sketch/apply:", e);
      htmlBody =
        "<p>Sketch auto-quote: calculation succeeded but template failed.</p>";
    }

    // 7) Send email via msgraph
    const base =
      process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const sendUrl = `${base}/api/msgraph/send`;

    const sendResp = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: `Updated foam quote ${quote.quote_no} (from sketch)`,
        html: htmlBody,
        inReplyTo: null
      })
    });

    const sent = await sendResp.json().catch(() => ({} as any));

    return NextResponse.json(
      {
        ok: true,
        quoteId: quote.id,
        quoteNo: quote.quote_no,
        attachmentId,
        toEmail,
        sent,
        calc,
        mergedDims,
        mergedQty,
        cavities,
        parsed
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("sketch/apply exception:", e);
    return err(
      "sketch_apply_exception",
      String(e?.message || e),
      500
    );
  }
}
