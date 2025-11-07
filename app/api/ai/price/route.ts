// app/api/ai/price/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function s(v: unknown) { return String(v ?? "").trim(); }
function n(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function requireEnv(name: string, ...alts: string[]) {
  const keys = [name, ...alts];
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return v!;
  }
  throw new Error(`Missing env: one of ${keys.join(", ")}`);
}

// Lazy pg pool
let _pool: Pool | null = null;
function pool() {
  if (_pool) return _pool;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as typeof import("pg");
  const connectionString = requireEnv("DATABASE_URL","POSTGRES_URL","POSTGRES_PRISMA_URL","PG_CONNECTION_STRING");
  _pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 3 });
  return _pool!;
}

type PriceInput = {
  slots: {
    internal_length_in: number;
    internal_width_in: number;
    internal_height_in: number;
    thickness_under_in?: number | null;
    qty: number;
    density_lbft3?: number | null;
    cavities?: Array<{ length_in: number; width_in: number; height_in: number; count?: number }>;
  };
};

function ci(L:number,W:number,H:number){ return Math.max(0,L)*Math.max(0,W)*Math.max(0,H); }
function round2(v:number){ return Math.round(v*100)/100; }

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PriceInput>;
    const slots = (body?.slots ?? {}) as PriceInput["slots"];

    const L = n(slots.internal_length_in) ?? 0;
    const W = n(slots.internal_width_in) ?? 0;
    const H = n(slots.internal_height_in) ?? 0;
    const T = n(slots.thickness_under_in) ?? 0;
    const Q = n(slots.qty) ?? 1;
    const dens = n(slots.density_lbft3);

    if (L<=0 || W<=0 || H<=0 || Q<=0) {
      return NextResponse.json({ ok:false, error:"missing or invalid dimensions/qty" }, { status:400 });
    }

    // volume
    let pieceCI = ci(L,W,H);
    const cavities = Array.isArray(slots.cavities) ? slots.cavities : [];
    let cavCI = 0;
    for (const c of cavities) {
      const len = n(c.length_in) ?? 0, wid = n(c.width_in) ?? 0, hei = n(c.height_in) ?? 0, cnt = n(c.count) ?? 1;
      cavCI += ci(len,wid,hei) * Math.max(1,cnt);
    }
    pieceCI = Math.max(0, pieceCI - cavCI);
    if (T>0) pieceCI += ci(L,W,T);

    const orderCI = pieceCI * Q;

    // material lookup (nearest density; else cheapest/default)
    const client = await pool().connect();
    try {
      let row: any | null = null;

      if (dens !== null) {
        const res = await client.query(
          `SELECT id,name,
                  COALESCE(density_lbft3,0)::float AS density_lbft3,
                  COALESCE(kerf_pct,0)::float      AS kerf_pct,
                  COALESCE(price_per_ci,0)::float  AS price_per_ci,
                  COALESCE(price_per_bf,0)::float  AS price_per_bf,
                  COALESCE(min_charge,0)::float    AS min_charge
           FROM materials
           WHERE density_lbft3 IS NOT NULL
           ORDER BY ABS(density_lbft3 - $1) ASC
           LIMIT 1`, [dens]);
        row = res.rows?.[0] ?? null;
      }

      if (!row) {
        const res = await client.query(
          `SELECT id,name,
                  COALESCE(density_lbft3,0)::float AS density_lbft3,
                  COALESCE(kerf_pct,0)::float      AS kerf_pct,
                  COALESCE(price_per_ci,0)::float  AS price_per_ci,
                  COALESCE(price_per_bf,0)::float  AS price_per_bf,
                  COALESCE(min_charge,0)::float    AS min_charge
           FROM materials
           ORDER BY price_per_ci NULLS LAST, price_per_bf NULLS LAST, id
           LIMIT 1`);
        row = res.rows?.[0] ?? null;
      }

      if (!row) {
        return NextResponse.json({ ok:false, error:"no materials found" }, { status:500 });
      }

      const kerf = Math.max(0, row.kerf_pct ?? 0);
      const pricePerCI = n(row.price_per_ci);
      const pricePerBF = n(row.price_per_bf);
      const minCharge  = Math.max(0, row.min_charge ?? 0);

      const orderCIWithWaste = orderCI * (1+kerf);

      let raw = 0;
      if (pricePerCI && pricePerCI>0) raw = orderCIWithWaste * pricePerCI;
      else if (pricePerBF && pricePerBF>0) raw = (orderCIWithWaste/1728) * pricePerBF;

      const total = Math.max(minCharge, raw);

      return NextResponse.json({
        ok:true,
        material:{
          id:row.id, name:row.name,
          density_lbft3: round2(row.density_lbft3 ?? 0),
          kerf_pct: round2(kerf),
          price_per_ci: pricePerCI,
          price_per_bf: pricePerBF,
          min_charge: round2(minCharge),
        },
        inputs:{
          length_in:L, width_in:W, height_in:H, thickness_under_in:T,
          qty:Q, density_lbft3:dens,
          cavities: cavities.map(c=>({ length_in:n(c.length_in)??0, width_in:n(c.width_in)??0, height_in:n(c.height_in)??0, count:n(c.count)??1 })),
        },
        ci:{
          piece_ci: round2(pieceCI),
          order_ci: round2(orderCI),
          order_ci_with_waste: round2(orderCIWithWaste),
        },
        pricing:{
          currency:"USD",
          raw: round2(raw),
          total: round2(total),
          used_min_charge: total < minCharge ? true : false,
        },
      }, { status:200 });
    } finally {
      client.release();
    }
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || "ai/price error" }, { status:500 });
  }
}
