// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package)
// by quote_no.
//
// GET /api/quote/print?quote_no=Q-AI-20251116-115613

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
};

type ItemRow = {
  id: number;
  quote_id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number;
  material_name: string | null;
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

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";

  if (!quoteNo) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_QUOTE_NO",
        message: "No quote_no was provided in the query string.",
      },
      { status: 400 },
    );
  }

  try {
    const quote = await one<QuoteRow>(
      `
        select id, quote_no, customer_name, email, phone, status, created_at
        from quotes
        where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return NextResponse.json(
        {
          ok: false,
          error: "NOT_FOUND",
          message: `No quote found with number ${quoteNo}.`,
        },
        { status: 404 },
      );
    }

    const items = await q<ItemRow>(
      `
        select
          qi.id,
          qi.quote_id,
          qi.length_in::text,
          qi.width_in::text,
          qi.height_in::text,
          qi.qty,
          qi.material_id,
          m.name as material_name
        from quote_items qi
        left join materials m on m.id = qi.material_id
        where qi.quote_id = $1
        order by qi.id asc
      `,
      [quote.id],
    );

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

    return NextResponse.json(
      {
        ok: true,
        quote,
        items,
        layoutPkg,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("Error in /api/quote/print:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem loading this quote. Please try again.",
      },
      { status: 500 },
    );
  }
}
