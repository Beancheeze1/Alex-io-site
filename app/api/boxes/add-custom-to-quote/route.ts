// app/api/boxes/add-custom-to-quote/route.ts
//
// POST /api/boxes/add-custom-to-quote
//
// The custom-entry counterpart to /api/boxes/add-to-quote: persists a
// customer/rep-typed box size (no catalog match) as a first-class
// quote_box_selections row (kind='custom') instead of the ephemeral
// customer_box_in facts value used before.
//
// A quote has at most one custom selection at a time — "the customer's
// custom box" is one fact about the quote, not a list — unlike stock
// selections, which can legitimately be multiple distinct SKUs. A second
// call replaces the existing custom row rather than adding another.
//
// Description + price are resolved once, at write time, via the shared
// app/lib/packaging-selection.ts resolver (freezes the closest matching
// stock box's tier price rather than recomputing it live on every render).
//
// Body JSON:
//   {
//     "quote_no": "Q-REP-...",
//     "length_in": 10,
//     "width_in": 10,
//     "height_in": 3,
//     "style": "mailer" | "rsc",
//     "qty": 10   // optional, defaults to 1
//   }

import { NextRequest, NextResponse } from "next/server";
import { one, withTxn } from "@/lib/db";
import { resolveCustomSelection } from "@/app/lib/packaging-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BodyIn = {
  quote_no?: string;
  length_in?: number | string | null;
  width_in?: number | string | null;
  height_in?: number | string | null;
  style?: string | null;
  qty?: number | string | null;
};

type QuoteRow = {
  id: number;
  quote_no: string;
};

type SelectionRow = {
  id: number;
  quote_id: number;
  quote_no: string;
  kind: string;
  box_id: number | null;
  sku: string | null;
  custom_length_in: string | number | null;
  custom_width_in: string | number | null;
  custom_height_in: string | number | null;
  custom_style: string | null;
  description: string | null;
  qty: number;
  created_at: string;
  unit_price_usd: string | number | null;
  extended_price_usd: string | number | null;
};

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

function toPositiveNumber(raw: any): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseQty(raw: any, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BodyIn;

    const quote_no = (body.quote_no || "").trim();
    if (!quote_no) {
      return bad({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
    }

    const L = toPositiveNumber(body.length_in);
    const W = toPositiveNumber(body.width_in);
    const H = toPositiveNumber(body.height_in);

    if (L == null || W == null || H == null) {
      return bad(
        {
          ok: false,
          error: "INVALID_DIMS",
          message: "length_in, width_in, and height_in must all be positive numbers.",
        },
        400,
      );
    }

    const style = (body.style || "").trim().toLowerCase();
    if (style !== "mailer" && style !== "rsc") {
      return bad(
        {
          ok: false,
          error: "INVALID_STYLE",
          message: "style must be 'mailer' or 'rsc'.",
        },
        400,
      );
    }

    const qty = parseQty(body.qty, 1);

    const quote = (await one<QuoteRow>(
      `
      SELECT id, quote_no
      FROM public.quotes
      WHERE quote_no = $1
      `,
      [quote_no],
    )) as QuoteRow | null;

    if (!quote) {
      return bad({ ok: false, error: "QUOTE_NOT_FOUND" }, 404);
    }

    const { description, unit_price_usd, extended_price_usd } = await resolveCustomSelection(
      L,
      W,
      H,
      style,
      qty,
    );

    const selection = await withTxn(async (tx) => {
      // A quote has at most one custom selection — replace, don't accumulate.
      await tx.query(
        `DELETE FROM public.quote_box_selections WHERE quote_id = $1 AND kind = 'custom'`,
        [quote.id],
      );

      const result = await tx.query<SelectionRow>(
        `
        INSERT INTO public.quote_box_selections
          (
            quote_id, quote_no, kind, box_id, sku,
            custom_length_in, custom_width_in, custom_height_in, custom_style,
            description, qty, unit_price_usd, extended_price_usd
          )
        VALUES
          ($1, $2, 'custom', NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          id, quote_id, quote_no, kind, box_id, sku,
          custom_length_in, custom_width_in, custom_height_in, custom_style,
          description, qty, created_at, unit_price_usd, extended_price_usd
        `,
        [quote.id, quote.quote_no, L, W, H, style, description, qty, unit_price_usd, extended_price_usd],
      );

      return (result.rows[0] ?? null) as SelectionRow | null;
    });

    if (!selection) {
      return bad(
        {
          ok: false,
          error: "SELECTION_FAILED",
          message: "Unable to create custom carton selection row.",
        },
        500,
      );
    }

    return ok({ ok: true, selection });
  } catch (err: any) {
    console.error("Error in /api/boxes/add-custom-to-quote", err);
    return bad(
      {
        ok: false,
        error: "INTERNAL_ERROR",
        message: String(err?.message || err),
      },
      500,
    );
  }
}
