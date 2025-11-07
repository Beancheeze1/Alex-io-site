// app/api/ai/price/route.ts
// DB-backed AI pricing: dynamic column detection + delegate to /api/quote/foam

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
  return (process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") || "http://localhost:3000");
}

type ColMap = {
  density: string | null;
  per_ci: string | null;
  per_bf: string | null;
  per_cuft: string | null;
  kerf_pct: string | null;
  min_charge: string | null;
};

async function detectMaterialColumns(): Promise<ColMap> {
  // Read available columns from public.materials
  const cols: Array<{ column_name: string }> = await q(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'materials'`
  );

  const have = new Set(cols.map(c => c.column_name.toLowerCase()));

  // Helper to pick the first that exists
  const pick = (candidates: string[]) => {
    for (const c of candidates) if (have.has(c.toLowerCase())) return c;
    return null;
  };

  return {
    density:  pick(["density_lbft3","density_lb_ft3","density","pcf","density_lbf_ft3"]),
    per_ci:   pick(["price_per_cuin","price_per_ci","price_per_cu_in","price_per_cubic_in","price_ci"]),
    per_bf:   pick(["price_per_bf","price_bf","price_per_board_foot"]),
    per_cuft: pick(["price_per_cuft","price_per_cu_ft","price_cuft","price_per_cubic_foot"]),
    kerf_pct: pick(["kerf_waste_pct","kerf_pct","waste_pct","kerf_percent"]),
    min_charge: pick(["min_charge_usd","min_charge","minimum_charge","min_order_charge_usd"]),
  };
}

function sqlExprOrNull(col: string | null, cast: "numeric" | "text" = "numeric") {
  if (!col) return `NULL::${cast}`;
  return cast === "numeric" ? `(${col})::numeric` : `${col}`;
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
    const C = Number.isFinite(N(slots.cavities)) ? Math.max(1, N(slots.cavities)!) : 1;

    // --- Discover schema & resolve material ---
    const cmap = await detectMaterialColumns();

    let materialId = Number.isFinite(N(slots.foam_material_id)) ? Number(slots.foam_material_id) : NaN;
    let resolvedMaterial: any = null;

    if (!Number.isFinite(materialId)) {
      const densityReq = N(slots.density_lbft3);
      if (!Number.isFinite(densityReq)) {
        throw new Error("provide foam_material_id or density_lbft3");
      }

      // Build a query that only references columns that actually exist
      const densityExpr = sqlExprOrNull(cmap.density, "numeric");
      const perCiExpr   = sqlExprOrNull(cmap.per_ci, "numeric");
      const perBfExpr   = sqlExprOrNull(cmap.per_bf, "numeric");
      const perCuftExpr = sqlExprOrNull(cmap.per_cuft, "numeric");
      const kerfExpr    = sqlExprOrNull(cmap.kerf_pct, "numeric");
      const minExpr     = sqlExprOrNull(cmap.min_charge, "numeric");

      // Choose closest density; prefer rows with *any* price column populated
      const rows = await q<any>(`
        with materials_any as (
          select
            m.id,
            coalesce(m.name, 'Material ' || m.id::text) as name,
            ${densityExpr} as density,
            ${perCiExpr}   as per_cu_in,
            ${perBfExpr}   as per_bf,
            ${perCuftExpr} as per_cu_ft,
            ${kerfExpr}    as kerf_waste_pct,
            ${minExpr}     as min_charge_usd
          from public.materials m
        ),
        ranked as (
          select *,
                 abs((density) - $1::numeric) as abs_diff,
                 case when per_cu_in is not null or per_bf is not null or per_cu_ft is not null then 1 else 0 end as has_price
          from materials_any
        )
        select *
        from ranked
        order by has_price desc, abs_diff asc, id asc
        limit 1
      `, [densityReq]);

      if (!rows.length) throw new Error("no material candidates");
      resolvedMaterial = rows[0];
      materialId = Number(resolvedMaterial.id);
    } else {
      // Fetch basic info for echoing back (avoid missing columns)
      const densityExpr = sqlExprOrNull(cmap.density, "numeric");
      const kerfExpr    = sqlExprOrNull(cmap.kerf_pct, "numeric");
      const minExpr     = sqlExprOrNull(cmap.min_charge, "numeric");
      resolvedMaterial = await one<any>(
        `select
            m.id,
            coalesce(m.name, 'Material ' || m.id::text) as name,
            ${densityExpr} as density,
            ${kerfExpr}    as kerf_waste_pct,
            ${minExpr}     as min_charge_usd
         from public.materials m
         where m.id = $1`, [materialId]
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
