// app/api/quote/layout/apply/route.ts
//
// Save a foam layout "package" against a quote.
// Called by the layout editor page (/quote/layout) when the user clicks
// "Apply to quote".
//
// POST JSON:
//   {
//     "quoteNo": "Q-AI-20251121-123456",
//     "layout": { ... LayoutModel ... },
//     "notes": "Loose parts in this pocket",
//     "svg": "<svg>...</svg>",
//     "dxf": "DXF text (optional, future)",
//     "step": "STEP text (optional, future)"
//   }
//
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Inserts a row into quote_layout_packages with layout_json + notes + svg_text
//     (and optional dxf_text / step_text)
//   - Returns the new package id + timestamps
//
// GET (optional debug):
//   - /api/quote/layout/apply?quote_no=Q-...   -> latest package for that quote

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LayoutApplyIn = {
  quoteNo?: string;
  layout?: any;
  notes?: string;
  svg?: string;
  dxf?: string;
  step?: string;
};

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function bad(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

/* ---------------------- GET: debug / latest package ---------------------- */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const quoteNo = url.searchParams.get("quote_no") || url.searchParams.get("quote");

  if (!quoteNo) {
    return ok({
      usage: "POST to save, GET ?quote_no=... to inspect latest layout package",
    });
  }

  // Latest package for this quote_no
  const row = await one<any>(
    `
    SELECT
      p.id,
      p.quote_id,
      q.quote_no,
      p.layout_json,
      p.notes,
      p.svg_text,
      p.dxf_text,
      p.step_text,
      p.created_at
    FROM quote_layout_packages p
    JOIN quotes q ON q.id = p.quote_id
    WHERE q.quote_no = $1
    ORDER BY p.created_at DESC
    LIMIT 1;
    `,
    [quoteNo],
  );

  if (!row) {
    return bad("layout_package_not_found", { quoteNo }, 404);
  }

  return ok({ package: row });
}

/* -------------------------- POST: save package --------------------------- */

export async function POST(req: NextRequest) {
  let body: LayoutApplyIn = {};
  let raw: string;

  // Read raw body once (more robust than req.json when things get weird)
  try {
    raw = await req.text();
  } catch {
    return bad("invalid_json", { message: "unable_to_read_body" });
  }

  if (!raw || !raw.trim()) {
    return bad("invalid_json", { message: "empty_body" });
  }

  // First attempt: treat as JSON
  try {
    body = JSON.parse(raw) as LayoutApplyIn;
  } catch {
    // Fallback: try URL-encoded form body
    try {
      const params = new URLSearchParams(raw);
      const layoutStr = params.get("layout");
      body = {
        quoteNo: params.get("quoteNo") || undefined,
        notes: params.get("notes") || undefined,
        svg: params.get("svg") || undefined,
        dxf: params.get("dxf") || undefined,
        step: params.get("step") || undefined,
        ...(layoutStr ? { layout: JSON.parse(layoutStr) } : {}),
      };
    } catch {
      return bad("invalid_json", {
        message: "unparseable_body",
      });
    }
  }

  const quoteNo = (body.quoteNo || "").trim();
  if (!quoteNo) {
    return bad("missing_quoteNo");
  }

  if (!body.layout) {
    return bad("missing_layout");
  }

  try {
    // Look up the quote row
    const quote = await one<{ id: number }>(
      `SELECT id FROM quotes WHERE quote_no = $1`,
      [quoteNo],
    );

    if (!quote) {
      return bad("quote_not_found", { quoteNo }, 404);
    }

    const notes =
      body.notes && body.notes.trim().length ? body.notes.trim() : null;
    const svgText =
      body.svg && body.svg.trim().length ? body.svg : null;
    const dxfText =
      body.dxf && body.dxf.trim().length ? body.dxf : null;
    const stepText =
      body.step && body.step.trim().length ? body.step : null;

    // Insert a new layout package row. We allow multiple versions per quote;
    // consumer code should use ORDER BY created_at DESC LIMIT 1 when reading.
    const inserted = await one<{
      id: number;
      quote_id: number;
      created_at: string;
    }>(
      `
      INSERT INTO quote_layout_packages
        (quote_id, layout_json, notes, svg_text, dxf_text, step_text)
      VALUES
        ($1, $2::jsonb, $3, $4, $5, $6)
      RETURNING id, quote_id, created_at;
      `,
      [quote.id, JSON.stringify(body.layout), notes, svgText, dxfText, stepText],
    );

    return ok({
      package: inserted,
    });
  } catch (e: any) {
    return bad("layout_apply_exception", { message: String(e?.message || e) }, 500);
  }
}
