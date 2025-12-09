// app/api/admin/boxes/route.ts
//
// Admin Carton Pricing API
// Path A safe: read & update carton pricing + tiers only.
// - GET:  list boxes + box_price_tiers (if present)
//   * If the box_price_tiers table or columns are missing/mismatched,
//     we gracefully fall back to returning boxes with NULL tier fields.
// - POST: save pricing for boxes (base price + up to 4 tiers)
//
// IMPORTANT:
// - Does NOT touch quote_items, quote_box_selections, or foam logic.
// - Allows NULL prices (blank inputs) and NULL tier mins.
// - Prices stored as numeric(12,2) (2 decimals).

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BoxWithTiersRow = {
  box_id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_length_in: string | number;
  inside_width_in: string | number;
  inside_height_in: string | number;

  tier_id: number | null;
  base_unit_price: string | number | null;
  tier1_min_qty: number | null;
  tier1_unit_price: string | number | null;
  tier2_min_qty: number | null;
  tier2_unit_price: string | number | null;
  tier3_min_qty: number | null;
  tier3_unit_price: string | number | null;
  tier4_min_qty: number | null;
  tier4_unit_price: string | number | null;
};

type BoxOnlyRow = {
  box_id: number;
  vendor: string;
  style: string;
  sku: string;
  description: string;
  inside_length_in: string | number;
  inside_width_in: string | number;
  inside_height_in: string | number;
};

type SaveUpdate = {
  box_id: number;
  tier_id?: number | null;
  base_unit_price?: string | number | null;
  tier1_min_qty?: string | number | null;
  tier1_unit_price?: string | number | null;
  tier2_min_qty?: string | number | null;
  tier2_unit_price?: string | number | null;
  tier3_min_qty?: string | number | null;
  tier3_unit_price?: string | number | null;
  tier4_min_qty?: string | number | null;
  tier4_unit_price?: string | number | null;
};

type SavePayload = {
  updates: SaveUpdate[];
};

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

function toNullableNumber(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNullableInt(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded <= 0) return null;
  return rounded;
}

// ---------- GET: list boxes + tiers (with safe fallback) ----------
export async function GET() {
  try {
    try {
      // Preferred path: join boxes + box_price_tiers
      const rows = await q<BoxWithTiersRow>(
        `
        select
          b.id as box_id,
          b.vendor,
          b.style,
          b.sku,
          b.description,
          b.inside_length_in,
          b.inside_width_in,
          b.inside_height_in,
          t.id as tier_id,
          t.base_unit_price,
          t.tier1_min_qty,
          t.tier1_unit_price,
          t.tier2_min_qty,
          t.tier2_unit_price,
          t.tier3_min_qty,
          t.tier3_unit_price,
          t.tier4_min_qty,
          t.tier4_unit_price
        from public.boxes b
        left join public.box_price_tiers t
          on t.box_id = b.id
        where b.active = true
        order by b.vendor, b.style, b.sku
        `,
        [],
      );

      return ok({
        ok: true,
        boxes: rows,
      });
    } catch (innerErr: any) {
      const msg = String(innerErr?.message ?? innerErr ?? "");
      const code = (innerErr && (innerErr as any).code) || "";

      // If the error looks like a missing table / bad column on box_price_tiers,
      // fall back to boxes-only so the UI still works.
      const isTierSchemaProblem =
        code === "42P01" || // undefined_table
        code === "42703" || // undefined_column
        msg.includes("box_price_tiers");

      if (!isTierSchemaProblem) {
        throw innerErr;
      }

      console.warn(
        "[/api/admin/boxes] box_price_tiers not ready; falling back to boxes-only:",
        { code, msg },
      );

      const boxesOnly = await q<BoxOnlyRow>(
        `
        select
          b.id as box_id,
          b.vendor,
          b.style,
          b.sku,
          b.description,
          b.inside_length_in,
          b.inside_width_in,
          b.inside_height_in
        from public.boxes b
        where b.active = true
        order by b.vendor, b.style, b.sku
        `,
        [],
      );

      const boxesWithNullTiers: BoxWithTiersRow[] = boxesOnly.map((b) => ({
        ...b,
        tier_id: null,
        base_unit_price: null,
        tier1_min_qty: null,
        tier1_unit_price: null,
        tier2_min_qty: null,
        tier2_unit_price: null,
        tier3_min_qty: null,
        tier3_unit_price: null,
        tier4_min_qty: null,
        tier4_unit_price: null,
      }));

      return ok({
        ok: true,
        boxes: boxesWithNullTiers,
      });
    }
  } catch (err: any) {
    console.error("Error in GET /api/admin/boxes:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem loading carton pricing. Please try again.",
      },
      500,
    );
  }
}

// ---------- POST: save pricing updates ----------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SavePayload | null;
    if (!body || !Array.isArray(body.updates)) {
      return bad(
        {
          ok: false,
          error: "INVALID_PAYLOAD",
          message: "Expected { updates: [...] }.",
        },
        400,
      );
    }

    let applied = 0;

    for (const u of body.updates) {
      const boxId = Number(u.box_id);
      if (!Number.isFinite(boxId) || boxId <= 0) {
        continue;
      }

      const base_unit_price = toNullableNumber(u.base_unit_price);
      const tier1_min_qty = toNullableInt(u.tier1_min_qty);
      const tier1_unit_price = toNullableNumber(u.tier1_unit_price);
      const tier2_min_qty = toNullableInt(u.tier2_min_qty);
      const tier2_unit_price = toNullableNumber(u.tier2_unit_price);
      const tier3_min_qty = toNullableInt(u.tier3_min_qty);
      const tier3_unit_price = toNullableNumber(u.tier3_unit_price);
      const tier4_min_qty = toNullableInt(u.tier4_min_qty);
      const tier4_unit_price = toNullableNumber(u.tier4_unit_price);

      const tierId = u.tier_id != null ? Number(u.tier_id) : null;

      if (tierId && Number.isFinite(tierId) && tierId > 0) {
        // Update existing tier row
        await q(
          `
          update public.box_price_tiers
          set
            base_unit_price = $1,
            tier1_min_qty = $2,
            tier1_unit_price = $3,
            tier2_min_qty = $4,
            tier2_unit_price = $5,
            tier3_min_qty = $6,
            tier3_unit_price = $7,
            tier4_min_qty = $8,
            tier4_unit_price = $9
          where id = $10
            and box_id = $11
          `,
          [
            base_unit_price,
            tier1_min_qty,
            tier1_unit_price,
            tier2_min_qty,
            tier2_unit_price,
            tier3_min_qty,
            tier3_unit_price,
            tier4_min_qty,
            tier4_unit_price,
            tierId,
            boxId,
          ],
        );
        applied += 1;
      } else {
        // Insert new tier row for this box
        await q(
          `
          insert into public.box_price_tiers (
            box_id,
            base_unit_price,
            tier1_min_qty,
            tier1_unit_price,
            tier2_min_qty,
            tier2_unit_price,
            tier3_min_qty,
            tier3_unit_price,
            tier4_min_qty,
            tier4_unit_price
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          on conflict (box_id) do update
          set
            base_unit_price = excluded.base_unit_price,
            tier1_min_qty = excluded.tier1_min_qty,
            tier1_unit_price = excluded.tier1_unit_price,
            tier2_min_qty = excluded.tier2_min_qty,
            tier2_unit_price = excluded.tier2_unit_price,
            tier3_min_qty = excluded.tier3_min_qty,
            tier3_unit_price = excluded.tier3_unit_price,
            tier4_min_qty = excluded.tier4_min_qty,
            tier4_unit_price = excluded.tier4_unit_price
          `,
          [
            boxId,
            base_unit_price,
            tier1_min_qty,
            tier1_unit_price,
            tier2_min_qty,
            tier2_unit_price,
            tier3_min_qty,
            tier3_unit_price,
            tier4_min_qty,
            tier4_unit_price,
          ],
        );
        applied += 1;
      }
    }

    return ok({
      ok: true,
      applied,
    });
  } catch (err: any) {
    console.error("Error in POST /api/admin/boxes:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem saving carton pricing. Please try again.",
      },
      500,
    );
  }
}
