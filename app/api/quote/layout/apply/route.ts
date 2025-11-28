// app/api/quote/layout/apply/route.ts
//
// Save a foam layout "package" against a quote.
// Called by the layout editor page (/quote/layout) when the user clicks
// "Apply to quote".
//
// POST JSON:
//   {
//     "quoteNo": "Q-AI-2025...",
//     "layout": { ... LayoutModel ... },
//     "notes": "Loose parts in this pocket",
//     "svg": "<svg>...</svg>",
//     "qty": 123,                (optional)
//     "materialId": 77          (optional)
//   }
//
// Behavior:
//   - Verify quote header exists
//   - Insert layout package into quote_layout_packages
//   - Update qty on primary quote_item (if qty provided)
//   - Update material_id on primary quote_item (ONLY IF materialId provided)
//   - Also store material info inside the quotes.facts JSON (optional helper)
//   - Return pkgId + timestamps
//

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/*                               POST APPLY ROUTE                             */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { quoteNo, layout, notes, svg, qty, materialId } = body || {};

    if (!quoteNo || typeof quoteNo !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing_quote_number" },
        { status: 400 },
      );
    }

    /* ---------------------------------------------------------------------- */
    /*                        Confirm quote header exists                     */
    /* ---------------------------------------------------------------------- */

    const header = await one(
      `SELECT id FROM quotes WHERE quote_no = $1`,
      [quoteNo],
    );

    if (!header) {
      return NextResponse.json(
        { ok: false, error: "quote_not_found" },
        { status: 404 },
      );
    }

    const quoteId = header.id;

    /* ---------------------------------------------------------------------- */
    /*                   Insert new layout package into DB                    */
    /* ---------------------------------------------------------------------- */

    const pkg = await one(
      `
      INSERT INTO quote_layout_packages (quote_id, layout_json, notes, svg_text)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at
      `,
      [quoteId, layout, notes ?? "", svg ?? ""],
    );

    // 🔧 TS STRICT FIX: pkg could be null → explicitly guard it
    if (!pkg) {
      return NextResponse.json(
        { ok: false, error: "layout_package_insert_failed" },
        { status: 500 },
      );
    }

    const pkgId = pkg.id;
    const pkgCreatedAt = pkg.created_at;

    /* ---------------------------------------------------------------------- */
    /*               Update primary quote_item quantity (optional)            */
    /* ---------------------------------------------------------------------- */

    if (qty != null) {
      const nQty = Number(qty);
      if (Number.isFinite(nQty) && nQty > 0) {
        await q(
          `
          UPDATE quote_items
          SET qty = $1
          WHERE quote_id = $2
          ORDER BY id ASC
          LIMIT 1
          `,
          [nQty, quoteId],
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /*                Update material on primary item (OPTION B)              */
    /*      Only update if materialId is provided AND is a valid number       */
    /* ---------------------------------------------------------------------- */

    if (materialId != null) {
      const nMat = Number(materialId);
      if (Number.isFinite(nMat) && nMat > 0) {
        // Update material_id on first quote_item
        await q(
          `
          UPDATE quote_items
          SET material_id = $1
          WHERE quote_id = $2
          ORDER BY id ASC
          LIMIT 1
          `,
          [nMat, quoteId],
        );

        // Also store material name inside quotes.facts
        const mat = await one(
          `SELECT name FROM materials WHERE id = $1`,
          [nMat],
        );

        const matName =
          mat && typeof mat.name === "string" ? mat.name : null;

        await q(
          `
          UPDATE quotes
          SET facts = jsonb_set(
            COALESCE(facts, '{}'::jsonb),
            '{material_id}',
            to_jsonb($1::int),
            true
          )
          `,
          [nMat],
        );

        if (matName) {
          await q(
            `
            UPDATE quotes
            SET facts = jsonb_set(
              COALESCE(facts, '{}'::jsonb),
              '{material_name}',
              to_jsonb($1::text),
              true
            )
            `,
            [matName],
          );
        }
      }
    }

    /* ---------------------------------------------------------------------- */
    /*                         SUCCESS RESPONSE                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json({
      ok: true,
      pkgId: pkgId,
      created_at: pkgCreatedAt,
    });
  } catch (err) {
    console.error("Error in POST /api/quote/layout/apply:", err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                          OPTIONAL GET DEBUG ROUTE                           */
/* -------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const quoteNo = url.searchParams.get("quote_no");

  if (!quoteNo) {
    return NextResponse.json(
      { ok: false, error: "missing_quote_number" },
      { status: 400 },
    );
  }

  const header = await one(
    `SELECT id FROM quotes WHERE quote_no = $1`,
    [quoteNo],
  );

  if (!header) {
    return NextResponse.json(
      { ok: false, error: "quote_not_found" },
      { status: 404 },
    );
  }

  const pkg = await one(
    `
    SELECT id, quote_id, layout_json, notes, svg_text, created_at
    FROM quote_layout_packages
    WHERE quote_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [header.id],
  );

  if (!pkg) {
    return NextResponse.json(
      { ok: false, error: "no_packages" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, pkg });
}
