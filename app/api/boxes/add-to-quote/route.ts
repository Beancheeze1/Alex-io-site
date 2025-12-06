// app/api/boxes/add-to-quote/route.ts
//
// POST /api/boxes/add-to-quote
//
// Body JSON:
//   {
//     "quote_no": "Q-AI-2025...",
//     "box_id": 123,        // preferred
//     "sku": "RSC-30-24-18",// optional if box_id omitted
//     "qty": 250            // optional, defaults to 1
//   }
//
// Behavior:
//   - Looks up the quote by quote_no.
//   - Looks up the box in public.boxes (by id or sku).
//   - Inserts a row into public.quote_box_selections.
//   - Returns ok:true + the selection row.
//
// Path A safe: no changes to existing quote or items tables;
// we just record the user's intent to add a carton.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";

type QuoteRow = {
  id: number;
  quote_no: string;
};

type BoxRow = {
  id: number;
  vendor: string;
  style: string;
  sku: string;
};

type BodyIn = {
  quote_no?: string;
  box_id?: number;
  sku?: string;
  qty?: number;
};

function parseQty(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BodyIn;

    const quote_no = (body.quote_no || "").trim();
    if (!quote_no) {
      return NextResponse.json(
        { ok: false, error: "quote_no is required" },
        { status: 400 },
      );
    }

    const hasBoxId = body.box_id !== undefined && body.box_id !== null;
    const hasSku = typeof body.sku === "string" && body.sku.trim().length > 0;

    if (!hasBoxId && !hasSku) {
      return NextResponse.json(
        {
          ok: false,
          error: "You must provide either box_id or sku",
        },
        { status: 400 },
      );
    }

    const qty = parseQty(body.qty, 1);

    // Look up the quote id from quotes table
    const quote = (await one<QuoteRow>(
      `SELECT id, quote_no
       FROM public."quotes"
       WHERE quote_no = $1`,
      [quote_no],
    )) as QuoteRow | null;

    if (!quote) {
      return NextResponse.json(
        {
          ok: false,
          error: `Quote not found for quote_no=${quote_no}`,
        },
        { status: 404 },
      );
    }

    // Look up the box in our boxes catalog
    let box: BoxRow | null = null;

    if (hasBoxId) {
      box = (await one<BoxRow>(
        `SELECT id, vendor, style, sku
         FROM public."boxes"
         WHERE id = $1`,
        [body.box_id],
      )) as BoxRow | null;
    } else if (hasSku) {
      const sku = body.sku!.trim();
      box = (await one<BoxRow>(
        `SELECT id, vendor, style, sku
         FROM public."boxes"
         WHERE sku = $1
         ORDER BY id
         LIMIT 1`,
        [sku],
      )) as BoxRow | null;
    }

    if (!box) {
      return NextResponse.json(
        {
          ok: false,
          error: "Box not found in boxes catalog",
        },
        { status: 404 },
      );
    }

    // Insert selection row
    const rows = await q(
      `
      INSERT INTO public.quote_box_selections
        (quote_id, quote_no, box_id, sku, qty)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, quote_id, quote_no, box_id, sku, qty, created_at
      `,
      [quote.id, quote.quote_no, box.id, box.sku, qty],
    );

    const selection = rows[0];

    return NextResponse.json({
      ok: true,
      selection,
    });
  } catch (err: any) {
    console.error("Error in /api/boxes/add-to-quote:", err);
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message ?? err),
      },
      { status: 500 },
    );
  }
}
