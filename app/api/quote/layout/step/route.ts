// app/api/quote/layout/step/route.ts
//
// Download the latest STEP file for a quote.
//
// GET /api/quote/layout/step?quote_no=Q-....
//
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Finds the most recent quote_layout_packages row for that quote
//     that has a non-null step_text
//   - Returns the STEP text as a file download:
//       Content-Type: application/step
//       Content-Disposition: attachment; filename="Q-XXXX.step"
//   - On error or missing data, returns a small JSON error payload.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
};

type LayoutPkgRow = {
  step_text: string | null;
  created_at: string;
};

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";

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

    const pkg = await one<LayoutPkgRow>(
      `
      select
        step_text,
        created_at
      from quote_layout_packages
      where quote_id = $1
        and step_text is not null
      order by created_at desc
      limit 1
      `,
      [quote.id],
    );

    if (!pkg || !pkg.step_text) {
      return json(
        {
          ok: false,
          error: "STEP_NOT_FOUND",
          message:
            "No STEP file has been saved for this quote yet. Try applying a layout first.",
        },
        404,
      );
    }

    const filename = `${quote.quote_no || quoteNo}.step`;

    return new NextResponse(pkg.step_text, {
      status: 200,
      headers: {
        "Content-Type": "application/step",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Error in /api/quote/layout/step GET:", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem loading the STEP file for this quote.",
      },
      500,
    );
  }
}
