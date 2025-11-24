// app/api/quote/layout/apply/route.ts
//
// Save a foam layout "package" against a quote AND update the primary
// quote item dimensions from the block in the layout.
// Called by the layout editor page (/quote/layout) when the user clicks
// "Apply to quote".
//
// POST JSON:
//   {
//     "quoteNo": "Q-AI-20251121-123456",
//     "layout": { ... LayoutModel ... },
//     "notes": "Loose parts in this pocket",
//     "svg": "<svg>...</svg>",
//     "qty": 250                // optional, updates quote_items.qty
//   }
//
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Inserts a row into quote_layout_packages with layout_json + notes + svg_text
//   - Updates the primary quote_items row for this quote so that
//     length_in / width_in / height_in (and optionally qty) match the layout.
//   - Returns the new package id + timestamps (+ optional updated item)
//
// GET (optional debug):
//   - /api/quote/layout/apply?quote_no=Q-...   -> latest package for that quote

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LayoutApplyIn = {
  quoteNo?: string;
  layout?: any;
  notes?: string;
  svg?: string;
  qty?: number | string;
};

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function bad(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

/* ---------------------- GET: debug / latest package ---------------------- */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const quoteNo =
    url.searchParams.get("quote_no") || url.searchParams.get("quote");

  if (!quoteNo) {
    return ok({
      usage:
        "POST to save, GET ?quote_no=... to inspect latest layout package",
    });
  }

  // Latest package for this quote_no
  const row = await one<any>(
    `
    SELECT
      p.id,
      p.quote_id,
      q.quote_no,
      p.layout_json,
      p.notes,
      p.svg_text,
      p.dxf_text,
      p.step_text,
      p.created_at
    FROM quote_layout_packages p
    JOIN quotes q ON q.id = p.quote_id
    WHERE q.quote_no = $1
    ORDER BY p.created_at DESC
    LIMIT 1;
    `,
    [quoteNo],
  );

  if (!row) {
    return bad("layout_package_not_found", { quoteNo }, 404);
  }

  return ok({ package: row });
}

/* -------------------------- POST: save package --------------------------- */

export async function POST(req: NextRequest) {
  let raw = "";
  let body: LayoutApplyIn;

  try {
    // Read the raw body text once and parse manually so we can see
    // exactly what arrived from the browser if parsing fails.
    raw = await req.text();

    if (!raw || !raw.trim()) {
      return bad("empty_body", { rawSnippet: "" });
    }

    const parsed = JSON.parse(raw);
    body = parsed as LayoutApplyIn;
  } catch (e: any) {
    return bad(
      "invalid_json",
      {
        message: String(e?.message || e),
        // Trim so we don't blast logs / responses with megabytes of SVG
        rawSnippet: raw ? raw.slice(0, 1000) : "",
      },
      400,
    );
  }

  const quoteNo = (body.quoteNo || "").trim();
  if (!quoteNo) {
    return bad("missing_quoteNo");
  }

  if (!body.layout) {
    return bad("missing_layout");
  }

  try {
    // Look up the quote row
    const quote = await one<{ id: number }>(
      `SELECT id FROM quotes WHERE quote_no = $1`,
      [quoteNo],
    );

    if (!quote) {
      return bad("quote_not_found", { quoteNo }, 404);
    }

    const notes =
      body.notes && body.notes.trim().length ? body.notes.trim() : null;
    const svgText = body.svg && body.svg.trim().length ? body.svg : null;

    // Parse qty (optional)
    let qtyVal: number | null = null;
    if (body.qty !== undefined) {
      const n = Number(body.qty);
      if (Number.isFinite(n) && n > 0) {
        qtyVal = n;
      }
    }

    // ---------- Update primary quote_item dims (and optional qty) ----------
    //
    // We treat the "primary" item as the first quote_items row for this quote.
    // The block in the layout is the foam blank dims (L/W/T), so we map:
    //   block.lengthIn    -> quote_items.length_in
    //   block.widthIn     -> quote_items.width_in
    //   block.thicknessIn -> quote_items.height_in
    //
    // If qtyVal is present, we also update quote_items.qty.

    let updatedItem: any = null;
    try {
      const block = (body.layout as any)?.block;

      if (block) {
        const L = Number(block.lengthIn);
        const W = Number(block.widthIn);
        const H = Number(block.thicknessIn ?? block.heightIn);

        const allFinite =
          [L, W, H].every((n) => Number.isFinite(n) && n > 0);

        if (allFinite) {
          if (qtyVal != null) {
            // Update dims + qty
            updatedItem = await one<any>(
              `
              UPDATE quote_items
              SET
                length_in  = $2,
                width_in   = $3,
                height_in  = $4,
                qty        = $5,
                updated_at = now()
              WHERE id = (
                SELECT id
                FROM quote_items
                WHERE quote_id = $1
                ORDER BY id ASC
                LIMIT 1
              )
              RETURNING id, quote_id, length_in, width_in, height_in, qty, material_id;
              `,
              [quote.id, L, W, H, qtyVal],
            );
          } else {
            // Update dims only
            updatedItem = await one<any>(
              `
              UPDATE quote_items
              SET
                length_in  = $2,
                width_in   = $3,
                height_in  = $4,
                updated_at = now()
              WHERE id = (
                SELECT id
                FROM quote_items
                WHERE quote_id = $1
                ORDER BY id ASC
                LIMIT 1
              )
              RETURNING id, quote_id, length_in, width_in, height_in, qty, material_id;
              `,
              [quote.id, L, W, H],
            );
          }
        }
      }
    } catch (updateErr) {
      // Don't fail the whole request if the item update has an issue.
      console.error(
        "layout/apply: quote_items update failed:",
        updateErr,
      );
    }

    // Insert a new layout package row. We allow multiple versions per quote;
    // consumer code should use ORDER BY created_at DESC LIMIT 1 when reading.
    const inserted = await one<{
      id: number;
      quote_id: number;
      created_at: string;
    }>(
      `
      INSERT INTO quote_layout_packages
        (quote_id, layout_json, notes, svg_text)
      VALUES
        ($1, $2::jsonb, $3, $4)
      RETURNING id, quote_id, created_at;
      `,
      [quote.id, JSON.stringify(body.layout), notes, svgText],
    );

    return ok({
      package: inserted,
      updatedItem: updatedItem || null,
    });
  } catch (e: any) {
    return bad(
      "layout_apply_exception",
      { message: String(e?.message || e) },
      500,
    );
  }
}
