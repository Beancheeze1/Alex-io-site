// app/api/quote/layout/apply/route.ts
//
// Save foam layout + notes + SVG for a quote.
// POST JSON:
// {
//   "quoteNo": "Q-AI-20251118-123456",
//   "layout": { ... LayoutModel ... },
//   "notes": "Any special instructions",
//   "svg": "<svg ...>"
// }

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const quoteNo = String(body.quoteNo || "").trim();
    const layout = body.layout;
    const notes = typeof body.notes === "string" ? body.notes : "";
    const svg = typeof body.svg === "string" ? body.svg : "";

    if (!quoteNo) {
      return NextResponse.json(
        { ok: false, error: "Missing quoteNo" },
        { status: 400 }
      );
    }

    if (!layout) {
      return NextResponse.json(
        { ok: false, error: "Missing layout" },
        { status: 400 }
      );
    }

    // Create table if it doesn't exist yet (safe, idempotent).
    await one(`
      CREATE TABLE IF NOT EXISTS quote_layouts (
        quote_no   text PRIMARY KEY,
        layout_json jsonb NOT NULL,
        svg         text,
        notes       text,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Upsert layout for this quote
    await one(
      `
      INSERT INTO quote_layouts (quote_no, layout_json, svg, notes, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (quote_no)
      DO UPDATE SET
        layout_json = EXCLUDED.layout_json,
        svg         = EXCLUDED.svg,
        notes       = EXCLUDED.notes,
        updated_at  = now();
    `,
      [quoteNo, layout, svg, notes]
    );

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("quote/layout/apply error", err);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
