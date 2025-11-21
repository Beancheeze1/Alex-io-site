// app/api/quote/layout/apply/route.ts
//
// Save foam layout + exports for a quote.
// Called from the layout editor "Apply to quote" button.
//
// POST JSON:
//   {
//     "quoteNo": "Q-AI-20251116-223023",
//     "layout": { block: {...}, cavities: [...] },
//     "notes": "extra dunnage on corners",
//     // svg is optional; server will regenerate from layout either way
//     "svg": "<svg ...>...</svg>"
//   }
//
// Behaviour:
//   - Look up quote by quote_no (from main quotes table)
//   - Build SVG + DXF + STEP stub from layout
//   - Insert into quote_layout_packages as a "package"
//   - Returns layoutPackageId for future use (downloads, UI, etc.)

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { buildLayoutExports } from "@/app/lib/layout/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingBody = {
  quoteNo?: string;
  layout?: any;
  notes?: string;
  svg?: string;
};

function badRequest(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch (err) {
    console.error("Invalid JSON in /api/quote/layout/apply", err);
    return badRequest("Invalid JSON body");
  }

  const { quoteNo, layout, notes } = body || {};

  if (!quoteNo || typeof quoteNo !== "string") {
    return badRequest("Missing quoteNo");
  }
  if (!layout || typeof layout !== "object") {
    return badRequest("Missing layout");
  }

  try {
    // 1) Look up the quote row by quote_no
    const quoteRow = await one(
      "select id from quotes where quote_no = $1",
      [quoteNo]
    );

    if (!quoteRow || !quoteRow.id) {
      return NextResponse.json(
        { ok: false, error: "Quote not found" },
        { status: 404 }
      );
    }

    const quoteId = quoteRow.id as number;

    // 2) Build exports (SVG + DXF + STEP stub) from the layout JSON
    const exportsBundle = buildLayoutExports(layout);

    // 3) Insert into quote_layout_packages
    const inserted = await one(
      `
      insert into quote_layout_packages
        (quote_id, layout_json, notes, svg_text, dxf_text, step_text)
      values
        ($1, $2, $3, $4, $5, $6)
      returning id
      `,
      [
        quoteId,
        JSON.stringify(layout),
        notes ?? null,
        exportsBundle.svg,
        exportsBundle.dxf,
        exportsBundle.step,
      ]
    );

    return NextResponse.json(
      {
        ok: true,
        layoutPackageId: inserted?.id ?? null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in /api/quote/layout/apply", err);
    return NextResponse.json(
      { ok: false, error: "Server error saving layout" },
      { status: 500 }
    );
  }
}
