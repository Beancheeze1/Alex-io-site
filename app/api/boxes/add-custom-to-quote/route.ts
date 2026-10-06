// app/api/boxes/add-custom-to-quote/route.ts
//
// POST /api/boxes/add-custom-to-quote
//
// The custom-entry counterpart to /api/boxes/add-to-quote: persists a
// customer/rep-typed box size (no catalog match) as a first-class
// quote_box_selections row (kind='custom').
//
// A quote has at most one custom selection at a time — a second call
// replaces the existing custom row rather than adding another.
//
// Description + price are resolved once, at write time, via the shared
// app/lib/packaging-selection.ts resolver: custom RSC → corrugated engine
// with the board grade (fallback: nearest stock + needs_review); mailer →
// nearest stock.
//
// Board grade: grade_id from the body (the Start Quote / rep pick, carried
// in the editor URL as box_grade). If the quote already has a custom row for
// the SAME box, its stored grade wins — the editor re-posts on every load,
// and that must not undo a grade staff changed on the admin quote page.
//
// Body JSON:
//   {
//     "quote_no": "Q-A-...",
//     "length_in": 10, "width_in": 10, "height_in": 3,
//     "style": "mailer" | "rsc",
//     "qty": 10,            // optional, defaults to 1
//     "grade_id": 2 | null  // optional, RSC only; null = shop default
//   }

import { NextRequest, NextResponse } from "next/server";
import { one, withTxn } from "@/lib/db";
import { customSelectionInsert, resolveCustomSelection } from "@/app/lib/packaging-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BodyIn = {
  quote_no?: string;
  length_in?: number | string | null;
  width_in?: number | string | null;
  height_in?: number | string | null;
  style?: string | null;
  qty?: number | string | null;
  grade_id?: number | string | null;
};

type QuoteRow = {
  id: number;
  quote_no: string;
  tenant_id: number | null;
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

function parseGradeId(raw: any): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
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
      SELECT id, quote_no, tenant_id
      FROM public.quotes
      WHERE quote_no = $1
      `,
      [quote_no],
    )) as QuoteRow | null;

    if (!quote) {
      return bad({ ok: false, error: "QUOTE_NOT_FOUND" }, 404);
    }

    // Same box already on the quote with a stored grade → keep that grade.
    const existing = await one<{
      custom_length_in: string | number;
      custom_width_in: string | number;
      custom_height_in: string | number;
      custom_style: string | null;
      board_grade_id: string | number | null;
    }>(
      `SELECT custom_length_in, custom_width_in, custom_height_in, custom_style, board_grade_id
         FROM public.quote_box_selections
        WHERE quote_id = $1 AND kind = 'custom'
        LIMIT 1`,
      [quote.id],
    );
    const sameBox =
      !!existing &&
      Number(existing.custom_length_in) === L &&
      Number(existing.custom_width_in) === W &&
      Number(existing.custom_height_in) === H &&
      String(existing.custom_style || "").toLowerCase() === style;
    const gradeId =
      sameBox && existing?.board_grade_id != null
        ? Number(existing.board_grade_id)
        : parseGradeId(body.grade_id);

    const resolved = await resolveCustomSelection(L, W, H, style, qty, quote.tenant_id, { gradeId });

    const selection = await withTxn(async (tx) => {
      // A quote has at most one custom selection — replace, don't accumulate.
      await tx.query(
        `DELETE FROM public.quote_box_selections WHERE quote_id = $1 AND kind = 'custom'`,
        [quote.id],
      );

      const ins = customSelectionInsert({
        quoteId: quote.id,
        quoteNo: quote.quote_no,
        L,
        W,
        H,
        style,
        qty,
        resolved,
      });
      const result = await tx.query(ins.text, ins.values);
      return result.rows[0] ?? null;
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

    // needs_review / pricing_note are staff-only: never returned here (public route).
    const { needs_review, pricing_note, ...publicSelection } = selection as Record<string, unknown>;
    void needs_review;
    void pricing_note;
    return ok({ ok: true, selection: publicSelection });
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
