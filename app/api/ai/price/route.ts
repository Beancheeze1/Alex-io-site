// app/api/ai/price/route.ts
// DB-backed AI pricing: resolve material (by id or density) then delegate to /api/quote/foam

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Slots = {
  internal_length_in?: number;
  internal_width_in?: number;
  internal_height_in?: number;
  thickness_under_in?: number;
  cavities?: number;
  qty?: number;
  density_lbft3?: number;     // optional if foam_material_id provided
  foam_material_id?: number;  // optional if density provided
};

function N(x: any) { const n = Number(x); return Number.isFinite(n) ? n : NaN; }
function requiredNumber(name: string, v: any) {
  const n = N(v);
  if (!Number.isFinite(n)) throw new Error(`missing or invalid ${name}`);
  return n;
}
function getBase() {
  // Use public base if present (Render/Cloudflare), otherwise local dev
  return (process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") || "http://localhost:3000");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const slots: Slots = (body?.slots || {}) as Slots;

    // --- Validate core dims for pricing ---
    const L = requiredNumber("internal_length_in", slots.internal_length_in);
    const W = requiredNumber("internal_width_in",  slots.internal_width_in);
    const H = requiredNumber("internal_height_in", slots.internal_height_in);
    const U = requiredNumber("thickness_under_in", slots.thickness_under_in);
    const QTY = Number.isFinite(N(slots.qty)) ? Math.max(1, N(slots.qty)!) : 1;

    // Optional cavities (just a count for now; your /quote/foam supports detailed shapes too)
    const C = Number.isFinite(N(slots.cavities)) ? Math.max(1, N(slots.cavities)!) : 1;

    // --- Resolve material ---
    let materialId = Number.isFinite(N(slots.foam_material_id)) ? Number(slots.foam_material_id) : NaN;
    let resolvedMaterial: any = null;

    if (!Number.isFinite(materialId)) {
      const density = N(slots.density_lbft3);
      if (!Number.isFinite(density)) {
        throw new Error("provide foam_material_id or density_lbft3");
      }

      // Try v_material_prices first if present, else fall back to materials table.
      // Choose the closest density (within a reasonable window) and prefer rows that have price fields populated.
      const rows = await q<any>(`
        with materials_any as (
          select
            m.id,
            coalesce(m.name, concat('Material ', m.id::text)) as name,
            coalesce(m.density_lbft3, m.density) as density,
            -- common price fields across schemas you use
            (m.price_per_cuin) as per_cu_in,
            (m.price_per_bf) as per_bf,
            (m.price_per_cuft) as per_cu_ft,
            m.kerf_waste_pct,
            m.min_charge_usd
          from public.materials m
        ),
        ranked as (
          select *,
                 abs((density)::numeric - $1::numeric) as abs_diff,
                 case when per_cu_in is not null or per_bf is not null or per_cu_ft is not null then 1 else 0 end as has_price
          from materials_any
        )
        select *
        from ranked
        order by has_price desc, abs_diff asc
        limit 1
      `, [density]);

      if (!rows.length) throw new Error("no material candidates");
      resolvedMaterial = rows[0];
      materialId = Number(resolvedMaterial.id);
    } else {
      // Fetch basic info for echoing back
      resolvedMaterial = await one<any>(
        `select id, name,
                coalesce(density_lbft3, density) as density,
                price_per_cuin as per_cu_in, price_per_bf as per_bf, price_per_cuft as per_cu_ft,
                kerf_waste_pct, min_charge_usd
         from public.materials
         where id = $1`,
        [materialId]
      );
    }

    if (!Number.isFinite(materialId)) throw new Error("material resolution failed");

    // --- Delegate pricing to your existing DB-backed route ---
    const foamPayload = {
      length_in: L,
      width_in:  W,
      height_in: H,
      qty: QTY,
      material_id: materialId,
      // Pass a simple under-pad as a single slot cavity-equivalent; your route will
      // subtract cavities from the volume and apply kerf/min-charge correctly.
      cavities: [
        { label: "rect", l: L, w: W, d: U, count: C }
      ]
    };

    const base = getBase();
    const res = await fetch(`${base}/api/quote/foam`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(foamPayload),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "quote_route_failed", status: res.status, detail: data ?? text ?? null },
        { status: 200 }
      );
    }

    // Shape a concise AI-friendly result
    return NextResponse.json({
      ok: true,
      material: {
        id: Number(materialId),
        name: resolvedMaterial?.name ?? `Material ${materialId}`,
        density_lbft3: resolvedMaterial?.density ?? null,
        kerf_waste_pct: resolvedMaterial?.kerf_waste_pct ?? null,
        min_charge_usd: resolvedMaterial?.min_charge_usd ?? null,
      },
      math: data?.math ?? null,
      pricing: data?.pricing ?? null,
      source: "/api/quote/foam"
    }, { status: 200 });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 200 });
  }
}
