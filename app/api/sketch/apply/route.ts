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
//   - Updates the quote item dims/qty (and cavities when present)
//   - Calls /api/quotes/calc to get pricing
//   - Uses renderQuoteEmail to build an updated email
//   - Sends email via /api/msgraph/send
//
// If the quote row has no email, we fall back to NEXT_PUBLIC_SALES_FORWARD_TO
// (your sales inbox) instead of throwing an error.
//
// NEW:
//   - Respects SKETCH_AUTO_QUOTE_ENABLED (if explicitly set to "false", only
//     emails the sales inbox instead of the customer).
//   - Persists merged dims/qty into quote_items so /quote printable + future
//     replies see the updated geometry.
//   - When cavityDims are present, stores them in quote_item_cavities using
//     normalized numeric dimensions compatible with /api/quotes/calc.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
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
  id: number;
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
    const salesInbox =
      process.env.NEXT_PUBLIC_SALES_FORWARD_TO ||
      process.env.NEXT_PUBLIC_FALLBACK_QUOTE_EMAIL ||
      "";

    const sketchAutoEnabled =
      String(process.env.SKETCH_AUTO_QUOTE_ENABLED || "true")
        .toLowerCase() !== "false";

    let emailMode: "customer" | "sales_only" = "customer";
    let toEmail: string | null = null;

    if (sketchAutoEnabled && quote.email) {
      // Normal path: send to customer (and they may CC/forward to sales as needed)
      toEmail = quote.email;
    } else {
      // Safety rails: when disabled, or when quote email is missing,
      // we send to sales inbox only.
      emailMode = "sales_only";
      toEmail = salesInbox || quote.email || null;
    }

    if (!toEmail) {
      // No customer email AND no configured fallback -> we can't send.
      return err("quote_missing_email", { quoteNo }, 500);
    }

    // 2) Load primary quote item (or create one with 1.7# PE fallback)
    let item = await one<QuoteItemRow>(
      `
      SELECT id, length_in, width_in, height_in, material_id, qty
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

// If qty is missing but we have dims, fall back to 1 piece so we can still quote.
// (We can revisit this default later if you want something else.)
let fallbackQty =
  parsed.qty && parsed.qty > 0 ? parsed.qty : 1;

if (!fallbackDims) {
  // We truly don't have enough info to safely create an item
  return err(
    "quote_item_not_found",
    {
      quoteId: quote.id,
      reason: "no_item_and_missing_parsed_dims",
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
        RETURNING id, length_in, width_in, height_in, material_id, qty;
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

    // Persist the merged dims/qty into quote_items so /quote + future replies
    // see the geometry we actually priced.
    try {
      const dimsNums = parseDims(mergedDims);
      await one(
        `
        UPDATE quote_items
        SET length_in = $1,
            width_in = $2,
            height_in = $3,
            qty = $4,
            updated_at = now()
        WHERE id = $5;
        `,
        [dimsNums.L, dimsNums.W, dimsNums.H, mergedQty, safeItem.id]
      );
    } catch (e) {
      console.error("Failed to update quote_items from sketch:", e);
    }

    // When we have cavities from the sketch, mirror them into quote_item_cavities.
    if (cavities.length > 0) {
      try {
        await q(
          `DELETE FROM quote_item_cavities WHERE quote_item_id = $1;`,
          [safeItem.id]
        );

        let idx = 0;
        const totalCount =
          parsed.cavityCount && parsed.cavityCount > 0
            ? parsed.cavityCount
            : 1;

        for (const raw of cavities) {
          const rawStr = String(raw || "").trim();
          if (!rawStr) continue;

          const isRound = /Ø|ø|\bdia\b|diameter/i.test(rawStr);
          const cleaned = rawStr
            .replace(/[Øø]/g, "")
            .replace(/\bdia\b/gi, "")
            .replace(/diameter/gi, "");

          const cavNums = parseDims(cleaned);
          const cavL = cavNums.L || 0;
          let cavW = cavNums.W || 0;
          const cavD = cavNums.H || 0;

          if (!cavL || !cavD) {
            continue;
          }

          if (isRound && !cavW) {
            // For round cavities we treat diameter as L and W
            cavW = cavL;
          }

          idx += 1;
          const label = `C${idx}`;
          const count = cavities.length === 1 ? totalCount : 1;

          await q(
            `
            INSERT INTO quote_item_cavities
              (quote_item_id, label, count, cav_length_in, cav_width_in, cav_depth_in)
            VALUES ($1, $2, $3, $4, $5, $6);
            `,
            [safeItem.id, label, count, cavL, cavW, cavD]
          );
        }
      } catch (e) {
        console.error("Failed to update quote_item_cavities from sketch:", e);
      }
    }

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
          (calc as any).price_total ??
          (calc as any).total ??
          (calc as any).order_total ??
          0,
        piece_ci: (calc as any).piece_ci ?? null,
        order_ci: (calc as any).order_ci ?? null,
        order_ci_with_waste: (calc as any).order_ci_with_waste ?? null,
        used_min_charge: (calc as any).min_charge_applied ?? null,
      },
      missing: [] as string[],
      facts: {
        quoteId: quote.id,
        quote_no: quote.quote_no,
        from: "sketch-auto-quote",
        attachmentId,
        sketchParsed: parsed,
        sketchAutoEnabled,
        emailMode,
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
        emailMode,
        sketchAutoEnabled,
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
