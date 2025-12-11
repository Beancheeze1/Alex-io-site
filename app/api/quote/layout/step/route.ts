// app/api/quote/layout/step/route.ts
//
// GET /api/quote/layout/step?quote_no=Q-...
//
// Returns the latest STEP file (step_text) for the given quote_no as a
// downloadable attachment.
//
// Behaviour (Path A):
//   - Look up quotes.id by quote_no.
//   - Find the latest row in quote_layout_packages for that quote.
//   - If step_text is present and non-empty, stream it with
//       Content-Type: application/step
//       Content-Disposition: attachment; filename="<quote>-layout.step"
//   - If missing, respond with JSON { ok:false, ... } and 404.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = {
  id: number;
  quote_no: string;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  step_text: string | null;
  created_at: string;
};

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = (url.searchParams.get("quote_no") || "").trim();

  if (!quoteNo) {
    return json(
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
      return json(
        {
          ok: false,
          error: "QUOTE_NOT_FOUND",
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
        step_text,
        created_at
      from quote_layout_packages
      where quote_id = $1
      order by created_at desc
      limit 1
      `,
      [quote.id],
    );

    if (!layoutPkg || !layoutPkg.step_text || layoutPkg.step_text.trim().length === 0) {
      return json(
        {
          ok: false,
          error: "STEP_NOT_AVAILABLE",
          message:
            "No STEP export is available yet for this quote. Try applying a layout again.",
        },
        404,
      );
    }

    const stepText = layoutPkg.step_text;
    const safeQuote = quote.quote_no.replace(/[^A-Za-z0-9_\-]+/g, "_");
    const filename = `${safeQuote}-layout.step`;

    return new NextResponse(stepText, {
      status: 200,
      headers: {
        "Content-Type": "application/step",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error in /api/quote/layout/step GET:", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: "There was an unexpected problem loading the STEP file.",
      },
      500,
    );
  }
}
