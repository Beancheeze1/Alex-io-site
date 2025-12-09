// app/api/boxes/for-quote/route.ts
//
// Read-only helper for admin views and quote viewer.
//
// Given a quote_no (e.g. ?quote_no=Q-AI-20251206-021028) this returns
// any cartons the customer has "requested" from the public quote viewer.
//
// Shape matches AdminQuoteClient / QuotePrintClient expectations:
//   {
//     ok: true,
//     selections: [
//       {
//         id: number;          // quote_box_selections.id
//         quote_id: number;
//         box_id: number;
//         sku: string;
//         vendor: string | null;
//         style: string | null;
//         description: string | null;
//         qty: number;
//         inside_length_in: number;
//         inside_width_in: number;
//         inside_height_in: number;
//         unit_price_usd?: number | null;
//         extended_price_usd?: number | null;
//       },
//       ...
//     ]
//   }
//
// Path A safe:
//   - SELECT-only, no writes.
//   - Does not touch pricing, cavity parsing, or layout logic.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  quote_id: number;
  box_id: number;
  sku: string;
  vendor: string | null;
  style: string | null;
  description: string | null;
  qty: number;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  unit_price_usd?: number | null;
  extended_price_usd?: number | null;
};

type Ok = {
  ok: true;
  selections: Row[];
};

type Err = {
  ok: false;
  error: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const quoteNo = (searchParams.get("quote_no") || "").trim();

    if (!quoteNo) {
      const body: Err = {
        ok: false,
        error: "Missing quote_no query parameter.",
      };
      return NextResponse.json(body, { status: 400 });
    }

    // Read-only join from quotes -> quote_box_selections -> boxes
    // NOTE: Path A tweak:
    //  - Use COALESCE(qbs.unit_price_usd, b.base_unit_price) for unit_price_usd
    //  - Derive extended_price_usd when missing using unit_price * qty
    const rows = (await q<Row>(
      `
      SELECT
        qbs.id,
        qbs.quote_id,
        qbs.box_id,
        b.sku,
        b.vendor,
        b.style,
        b.description,
        qbs.qty,
        b.inside_length_in,
        b.inside_width_in,
        b.inside_height_in,
        COALESCE(qbs.unit_price_usd, b.base_unit_price) AS unit_price_usd,
        COALESCE(
          qbs.extended_price_usd,
          COALESCE(qbs.unit_price_usd, b.base_unit_price) * qbs.qty
        ) AS extended_price_usd
      FROM public.quote_box_selections AS qbs
      JOIN public."quotes" AS q
        ON q.id = qbs.quote_id
      JOIN public.boxes AS b
        ON b.id = qbs.box_id
      WHERE q.quote_no = $1
      ORDER BY qbs.id ASC
      `,
      [quoteNo],
    )) as Row[];

    const body: Ok = {
      ok: true,
      selections: rows || [],
    };

    return NextResponse.json(body);
  } catch (err: any) {
    console.error("Error in /api/boxes/for-quote:", err);
    const body: Err = {
      ok: false,
      error:
        typeof err?.message === "string"
          ? err.message
          : "Unexpected error loading requested cartons for this quote.",
    };
    return NextResponse.json(body, { status: 500 });
  }
}
