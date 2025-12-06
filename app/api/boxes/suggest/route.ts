// app/api/boxes/suggest/route.ts
//
// Box suggestion helper:
//
//   GET /api/boxes/suggest?length_in=10&width_in=8&height_in=3&style=both
//
// MVP behavior (Path A safe):
//   - Uses raw dims from query params (length_in, width_in, height_in).
//   - Adds clearance_in (default 0.5") to each dimension.
//   - Queries public.boxes for active boxes that fit.
//   - Supports style modes:
//       style=rsc    -> only RSC boxes
//       style=mailer -> only Mailers
//       style=both   -> both, returned as separate arrays.
//   - Sorts by volume (L*W*H ascending) as a proxy for "cheapest / most efficient".
//   - Limit per style (default 3).
//
// Later (separate step):
//   - Add quote_no support by looking up block dims from quote/layout facts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

type BoxRow = {
  id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_length_in: string | number;
  inside_width_in: string | number;
  inside_height_in: string | number;
  min_order_qty: number | null;
  bundle_qty: number | null;
  notes: string | null;
};

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parsePositiveFloat(value: string | null, name: string): number {
  if (!value) {
    throw new Error(`Missing required query param: ${name}`);
  }
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }
  return n;
}

function parseNonNegativeFloat(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseLimit(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function normalizeStyleParam(styleRaw: string | null): "rsc" | "mailer" | "both" {
  if (!styleRaw) return "both";
  const v = styleRaw.toLowerCase();
  if (v === "rsc" || v === "mailer" || v === "both") return v;
  return "both";
}

function computeVolume(l: number, w: number, h: number): number {
  return l * w * h;
}

function mapBoxRow(row: BoxRow) {
  const l = toNumber(row.inside_length_in) ?? 0;
  const w = toNumber(row.inside_width_in) ?? 0;
  const h = toNumber(row.inside_height_in) ?? 0;

  return {
    id: row.id,
    vendor: row.vendor,
    style: row.style,
    sku: row.sku,
    description: row.description,
    inside_length_in: l,
    inside_width_in: w,
    inside_height_in: h,
    min_order_qty: row.min_order_qty,
    bundle_qty: row.bundle_qty,
    notes: row.notes,
    volume: computeVolume(l, w, h),
  };
}

async function fetchBoxesForStyle(
  style: "RSC" | "Mailer",
  L_req: number,
  W_req: number,
  H_req: number,
  limit: number,
) {
  const rows: BoxRow[] = await q(
    `
    SELECT
      id,
      vendor,
      style,
      sku,
      description,
      inside_length_in,
      inside_width_in,
      inside_height_in,
      min_order_qty,
      bundle_qty,
      notes
    FROM public."boxes"
    WHERE active = true
      AND style = $1
      AND inside_length_in >= $2
      AND inside_width_in  >= $3
      AND inside_height_in >= $4
    `,
    [style, L_req, W_req, H_req],
  );

  const mapped = rows.map(mapBoxRow);
  mapped.sort((a, b) => a.volume - b.volume); // smallest volume first
  return mapped.slice(0, limit);
}

// GET /api/boxes/suggest
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Required dims (foam block)
    const lengthIn = parsePositiveFloat(searchParams.get("length_in"), "length_in");
    const widthIn = parsePositiveFloat(searchParams.get("width_in"), "width_in");
    const heightIn = parsePositiveFloat(searchParams.get("height_in"), "height_in");

    // Optional params
    const clearanceIn = parseNonNegativeFloat(searchParams.get("clearance_in"), 0.5);
    const styleMode = normalizeStyleParam(searchParams.get("style"));
    const limitPerStyle = parseLimit(searchParams.get("limit"), 3, 20);

    const L_req = lengthIn + clearanceIn;
    const W_req = widthIn + clearanceIn;
    const H_req = heightIn + clearanceIn;

    const [rsc, mailer] = await Promise.all([
      styleMode === "rsc" || styleMode === "both"
        ? fetchBoxesForStyle("RSC", L_req, W_req, H_req, limitPerStyle)
        : Promise.resolve([]),
      styleMode === "mailer" || styleMode === "both"
        ? fetchBoxesForStyle("Mailer", L_req, W_req, H_req, limitPerStyle)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      ok: true,
      block: {
        length_in: lengthIn,
        width_in: widthIn,
        height_in: heightIn,
        clearance_in: clearanceIn,
        required_inside: {
          length_in: L_req,
          width_in: W_req,
          height_in: H_req,
        },
      },
      style_mode: styleMode,
      rsc,
      mailer,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message ?? err),
      },
      { status: 400 },
    );
  }
}
