// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package)
// by quote_no, and attaches a pricing snapshot to each item using
// the volumetric calc route.
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
  // These are NOT read from DB; we attach them after calling calc.
  price_unit_usd?: number | null;
  price_total_usd?: number | null;
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

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

function parseDimsNums(item: ItemRow) {
  const L = Number(item.length_in);
  const W = Number(item.width_in);
  const H = Number(item.height_in);
  return { L, W, H };
}

async function attachPricingToItem(item: ItemRow): Promise<ItemRow> {
  try {
    const { L, W, H } = parseDimsNums(item);
    const qty = Number(item.qty);
    const materialId = Number(item.material_id);

    if (
      ![L, W, H, qty, materialId].every(
        (n) => Number.isFinite(n) && n > 0,
      )
    ) {
      // Keep original item if we can't safely calc.
      return item;
    }

    const base =
      process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const resp = await fetch(`${base}/api/quotes/calc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        length_in: L,
        width_in: W,
        height_in: H,
        material_id: materialId,
        qty,
        cavities: [],
        round_to_bf: false,
      }),
    });

    const json = await resp.json().catch(() => null as any);
    if (!resp.ok || !json || !json.ok || !json.result) {
      // If calc fails for any reason, just return the bare item.
      return item;
    }

    const rawTotal = Number(json.result.total ?? 0);
    const total =
      Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0;
    const piece =
      qty > 0 && Number.isFinite(total) ? total / qty : null;

    return {
      ...item,
      price_total_usd: Number.isFinite(total) ? total : null,
      price_unit_usd:
        piece != null && Number.isFinite(piece) ? piece : null,
    };
  } catch (err) {
    console.error("attachPricingToItem error:", err);
    return item;
  }
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
        select id, quote_no, customer_name, email, phone, status, created_at
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

    const itemsRaw = await q<ItemRow>(
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

    // Attach pricing via the volumetric calc route.
    // This is best-effort: if calc fails, items stay as-is.
    const items: ItemRow[] = await Promise.all(
      itemsRaw.map((it) => attachPricingToItem(it)),
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

    return ok(
      {
        ok: true,
        quote,
        items,
        layoutPkg,
      },
      200,
    );
  } catch (err) {
    console.error("Error in /api/quote/print:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem loading this quote. Please try again.",
      },
      500,
    );
  }
}
