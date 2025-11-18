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
//   - If no quote item exists, creates one using a fallback material (1.7# PE)
//   - Merges in dims / cavities from `parsed` (vision)
//   - Calls /api/quotes/calc to get pricing
//   - Uses renderQuoteEmail to build an updated email
//   - Sends email via /api/msgraph/send
//   - Stores sketch-derived dims/qty/cavities/material (and optimizer ideas)
//     into memory under quote_no
//
// If the quote row has no email, we fall back to NEXT_PUBLIC_SALES_FORWARD_TO
// (your sales inbox) instead of throwing an error.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";
import { saveFacts } from "@/app/lib/memory";

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
    H: parts[2] || 0,
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
      round_to_bf: false,
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j.ok) return null;
  return j.result;
}

// AI Design Optimizer for sketch flows.
// Mirrors the orchestrator version at a high level but uses a simpler facts shape.
async function aiDesignSuggestionsFromSketch(
  model: string,
  facts: {
    dims: string | null;
    qty: number | null;
    material: string | null;
    density: string | null;
    cavityCount: number | null;
    cavityDims: string[];
  },
  calc: any
): Promise<string[] | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  try {
    const payload = {
      ...facts,
      piece_ci: calc?.piece_ci ?? null,
      order_ci: calc?.order_ci_with_waste ?? calc?.order_ci ?? null,
      total:
        calc?.price_total ?? calc?.total ?? calc?.order_total ?? null,
    };

    const prompt = `
You are a foam packaging estimator.

You will be given JSON for a sketch-based foam quote:
- dims: outside size string like "12x10x2"
- qty: pieces
- material + density
- cavityCount / cavityDims
- piece_ci / order_ci / total

Suggest a few practical, realistic ways to optimize cost OR performance.

Guidelines:
- Focus on knobs foam buyers actually adjust (material family, density, thickness, cavity layout, or quantity).
- Assume normal drop heights (under ~36") unless clearly extreme.
- Avoid generic statements like "talk to your vendor".
- Keep each idea to one short sentence.
- Do not contradict the current design; just suggest variations or options.

Return ONLY JSON:
{
  "suggestions": [
    "short bullet...",
    "short bullet..."
  ]
}

Aim for 2–4 ideas max.

Sketch quote data (JSON):
${JSON.stringify(payload, null, 2)}
    `.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 220,
        temperature: 0.3,
      }),
    });

    const raw = await r.text();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return null;

    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed.suggestions)) return null;

    const cleaned = parsed.suggestions
      .map((s: any) => (typeof s === "string" ? s.trim() : ""))
      .filter((s: string) => s.length > 0)
      .slice(0, 4);

    return cleaned.length ? cleaned : null;
  } catch (e) {
    console.error("aiDesignSuggestionsFromSketch failed:", e);
    return null;
  }
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

    // 2) Load primary quote item (or create one with 1.7# PE fallback)
    let item: QuoteItemRow | null = await one<QuoteItemRow>(
      `
      SELECT length_in, width_in, height_in, material_id, qty
      FROM quote_items
      WHERE quote_id = $1
      ORDER BY id ASC
      LIMIT 1;
      `,
      [quote.id]
    );

    let material: MaterialRow | null = null;

    if (!item) {
      // --- Fallback path: no item yet; create one using parsed dims/qty and 1.7# PE ---
      const fallbackDims =
        parsed.dims && parsed.dims.trim() ? parsed.dims.trim() : null;
      const fallbackQty =
        parsed.qty && parsed.qty > 0 ? parsed.qty : null;

      if (!fallbackDims || !fallbackQty) {
        // We don't have enough info to safely create an item
        return err(
          "quote_item_not_found",
          {
            quoteId: quote.id,
            reason: "no_item_and_missing_parsed_dims_or_qty",
          },
          404
        );
      }

      // Find a fallback material ≈ 1.7# PE
      const fallbackMaterial = await one<MaterialRow>(
        `
        SELECT
          id,
          name,
          density_lb_ft3,
          kerf_waste_pct AS kerf_pct,
          min_charge_usd AS min_charge
        FROM materials
        WHERE active = true
          AND (name ILIKE '%pe%' OR category ILIKE '%pe%' OR subcategory ILIKE '%pe%')
        ORDER BY ABS(COALESCE(density_lb_ft3, 0) - 1.7)
        LIMIT 1;
        `,
        []
      );

      if (!fallbackMaterial) {
        return err(
          "material_not_found",
          {
            quoteId: quote.id,
            reason: "no_fallback_1_7_pe",
          },
          404
        );
      }

      const { L, W, H } = parseDims(fallbackDims);

      const insertedItem = await one<QuoteItemRow>(
        `
        INSERT INTO quote_items
          (quote_id, length_in, width_in, height_in, material_id, qty)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING length_in, width_in, height_in, material_id, qty;
        `,
        [quote.id, L, W, H, fallbackMaterial.id, fallbackQty]
      );

      item = insertedItem;
      material = fallbackMaterial;
    }

    // 3) Load material info (normal path or confirm fallback)
    if (!material && item) {
      material = await one<MaterialRow>(
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
    }

    // Hard guards so TS knows both are non-null below
    if (!item) {
      return err(
        "quote_item_not_found",
        { quoteId: quote.id, reason: "no_item_after_fallback" },
        404
      );
    }

    if (!material) {
      return err(
        "material_not_found",
        { material_id: item.material_id, reason: "no_material_after_fallback" },
        404
      );
    }

    const safeItem = item;
    const safeMaterial = material;

    // 4) Merge dims / qty / cavities from parsed sketch + existing item
    const baseDims = `${safeItem.length_in}x${safeItem.width_in}x${safeItem.height_in}`;
    const mergedDims =
      parsed.dims && parsed.dims.trim() ? parsed.dims.trim() : baseDims;

    const mergedQty =
      parsed.qty && parsed.qty > 0 ? parsed.qty : safeItem.qty;

    const cavities =
      Array.isArray(parsed.cavityDims) && parsed.cavityDims.length > 0
        ? parsed.cavityDims
        : [];

    // 5) Re-run calc using merged dims / qty / cavities
    const calc = await calcQuoteCI({
      dims: mergedDims,
      qty: mergedQty,
      material_id: safeMaterial.id,
      cavities,
    });

    if (!calc) {
      return err("calc_failed", { quoteId: quote.id }, 500);
    }

    // 5.5) AI Design Optimizer from sketch context
    const cavityCount =
      parsed.cavityCount != null
        ? parsed.cavityCount
        : cavities.length > 0
        ? cavities.length
        : null;

    let optSuggestions: string[] | null = null;
    try {
      optSuggestions = await aiDesignSuggestionsFromSketch(
        "gpt-4.1-mini",
        {
          dims: mergedDims || null,
          qty: mergedQty || null,
          material: safeMaterial.name || null,
          density:
            parsed.density ??
            (safeMaterial.density_lb_ft3 != null
              ? `${safeMaterial.density_lb_ft3}lb`
              : null),
          cavityCount,
          cavityDims: cavities || [],
        },
        calc
      );
    } catch (e) {
      console.error("aiDesignSuggestionsFromSketch (apply) failed:", e);
    }

    // 5.6) Store sketch facts in memory keyed by quote_no
    const sketchFacts = {
      fromSketch: true,
      quote_id: quote.id,
      quote_no: quote.quote_no,
      // dims / qty / cavities
      dims: mergedDims,
      qty: mergedQty,
      cavityDims: cavities,
      cavityCount,
      sketchNotes: parsed.notes || null,
      sketchAttachmentId: attachmentId,
      // material context so orchestrator can reuse it later
      material_id: safeMaterial.id,
      material_name: safeMaterial.name,
      material: safeMaterial.name,
      density:
        safeMaterial.density_lb_ft3 != null
          ? `${safeMaterial.density_lb_ft3}lb`
          : null,
      kerf_pct: safeMaterial.kerf_pct,
      min_charge: safeMaterial.min_charge,
      // NEW: design optimization ideas from sketch
      opt_suggestions: optSuggestions || undefined,
    };

    try {
      await saveFacts(quote.quote_no, sketchFacts);
    } catch (e) {
      console.error("saveFacts (sketch/apply) failed:", e);
    }

    // 6) Build email using the main template
    const { L, W, H } = parseDims(mergedDims);
    const densityPcf =
      parsed.density != null
        ? densityToPcf(parsed.density)
        : safeMaterial.density_lb_ft3;

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
        foam_family: safeMaterial.name,
        thickness_under_in: null,
        color: null,
      },
      material: {
        name: safeMaterial.name,
        density_lbft3: safeMaterial.density_lb_ft3,
        kerf_pct: safeMaterial.kerf_pct,
        min_charge: safeMaterial.min_charge,
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
        used_min_charge: calc.min_charge_applied ?? null,
      },
      missing: [] as string[],
      facts: {
        quoteId: quote.id,
        quote_no: quote.quote_no,
        from: "sketch-auto-quote",
        fromSketch: true,
        attachmentId,
        sketchParsed: parsed,
        sketchFactsKey: quote.quote_no,
        cavityCount,
        cavityDims: cavities,
        // mirror key material context into template facts too
        material_id: safeMaterial.id,
        material_name: safeMaterial.name,
        material: safeMaterial.name,
        density:
          safeMaterial.density_lb_ft3 != null
            ? `${safeMaterial.density_lb_ft3}lb`
            : null,
        kerf_pct: safeMaterial.kerf_pct,
        min_charge: safeMaterial.min_charge,
        // NEW: pass optimizer ideas into template facts
        opt_suggestions: optSuggestions || undefined,
      },
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
        inReplyTo: null,
      }),
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
        parsed,
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
