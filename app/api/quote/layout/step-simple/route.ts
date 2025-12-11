// app/api/quote/layout/step-simple/route.ts
//
// GET /api/quote/layout/step-simple?quote_no=Q-...
//
// Returns a SIMPLE STEP file (BLOCK primitives only) for the latest
// layout on a quote. This is intended for Bambu Studio / lightweight
// viewers that can't handle full BREP/boolean STEP files.
//
// Important:
//   - This does NOT read quote_layout_packages.step_text.
//   - Instead, it rebuilds a simple STEP on the fly from layout_json.
//   - Full /api/quote/layout/step continues to serve the BREP export
//     saved by buildStepFromLayoutFull (for Solidworks, etc).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { buildStepFromLayoutSimple } from "@/lib/cad/step";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";

  if (!quoteNo) {
    return bad(
      {
        ok: false,
        error: "MISSING_QUOTE_NO",
        message: "No quote_no was provided in the query string.",
      },
      400,
    );
  }

  try {
    const quote = await one<QuoteRow>(
      `
      select id, quote_no
      from quotes
      where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "NOT_FOUND",
          message: `No quote found with number ${quoteNo}.`,
        },
        404,
      );
    }

    const layoutPkg = await one<LayoutPkgRow>(
      `
      select
        id,
        quote_id,
        layout_json,
        notes,
        svg_text,
        dxf_text,
        step_text,
        created_at
      from quote_layout_packages
      where quote_id = $1
      order by created_at desc
      limit 1
      `,
      [quote.id],
    );

    if (!layoutPkg || !layoutPkg.layout_json) {
      return bad(
        {
          ok: false,
          error: "LAYOUT_NOT_FOUND",
          message: "No layout has been saved for this quote yet. Try applying a layout first.",
        },
        404,
      );
    }

    // For the simple exporter we don't strictly need material info; pass null.
    const stepText = buildStepFromLayoutSimple(
      layoutPkg.layout_json,
      quote.quote_no,
      null,
    );

    if (!stepText) {
      return bad(
        {
          ok: false,
          error: "STEP_BUILD_FAILED",
          message:
            "Unable to build a simple STEP file for this layout. Check that block + layer dimensions are valid.",
        },
        500,
      );
    }

    const fileName = `${quote.quote_no}-simple.step`;

    return new NextResponse(stepText, {
      status: 200,
      headers: {
        "Content-Type": "application/step",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("Error in /api/quote/layout/step-simple GET:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem building the simple STEP file for this quote.",
      },
      500,
    );
  }
}
