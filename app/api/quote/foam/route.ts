import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------- DB pool -------------------- */
let _pool: Pool | null = null;
function pool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing env: DATABASE_URL");
    _pool = new Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
  }
  return _pool!;
}

/* -------------------- Cavity math -------------------- */
type RectLike = { label: "slot" | "square" | "rect"; w?: number; l?: number; d?: number; count?: number };
type CircleLike = { label: "circle" | "round"; dia?: number; d?: number; count?: number };
type Cavity = RectLike | CircleLike;

function N(x: any) { const n = Number(x); return isFinite(n) ? n : 0; }

function cavityCuIn(c: Cavity): number {
  const count = Math.max(1, N((c as any).count));
  const d = Math.max(0, N((c as any).d));
  if (c.label === "slot" || c.label === "square" || c.label === "rect") {
    const w = Math.max(0, N((c as any).w));
    const l = Math.max(0, N((c as any).l));
    return w * l * d * count;
  }
  if (c.label === "circle" || c.label === "round") {
    const dia = Math.max(0, N((c as any).dia));
    const r = dia / 2;
    return Math.PI * r * r * d * count;
  }
  return 0;
}
function computeCavitiesCuIn(cavities: Cavity[] | undefined | null): number {
  if (!Array.isArray(cavities)) return 0;
  return cavities.reduce((s, c) => s + cavityCuIn(c), 0);
}

/* -------------------- Route -------------------- */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const length_in = N(body.length_in);
    const width_in  = N(body.width_in);
    const height_in = N(body.height_in);
    const qty       = Math.max(1, N(body.qty));
    const material_id = Math.max(1, N(body.material_id));
    const cavities: Cavity[] = Array.isArray(body.cavities) ? body.cavities : [];

    if (length_in <= 0 || width_in <= 0 || height_in <= 0) {
      return NextResponse.json({ error: "length_in, width_in, height_in must be > 0" }, { status: 400 });
    }

    // material pricing from DB
    const q = `
      SELECT id, name,
             COALESCE(price_per_cuin, 0)  AS price_per_cuin,
             COALESCE(kerf_waste_pct, 0)  AS kerf_waste_pct,
             COALESCE(min_charge_usd, 0)  AS min_charge_usd
      FROM public.materials
      WHERE id = $1
    `;
    const { rows } = await pool().query(q, [material_id]);
    if (!rows.length) return NextResponse.json({ error: "bad material_id" }, { status: 400 });

    const mat = rows[0] as {
      id: number; name: string; price_per_cuin: number; kerf_waste_pct: number; min_charge_usd: number;
    };

    const ext_cuin = length_in * width_in * height_in;
    const cav_cuin = computeCavitiesCuIn(cavities);
    const net_cuin = Math.max(0, ext_cuin - cav_cuin);

    const kerf_pct = Math.max(0, Number(mat.kerf_waste_pct) || 0);
    const kerf_factor = 1 + kerf_pct / 100;
    const bill_cuin = net_cuin * kerf_factor;

    const unit_price_usd = Number(mat.price_per_cuin) || 0;
    const min_charge_usd = Number(mat.min_charge_usd) || 0;

    const piece_price_usd = Math.max(min_charge_usd, unit_price_usd * bill_cuin);
    const total_price_usd = piece_price_usd * qty;

    return NextResponse.json({
      ok: true,
      input: { length_in, width_in, height_in, qty, material_id, cavities },
      material: {
        id: mat.id, name: mat.name,
        price_per_cuin: unit_price_usd,
        kerf_waste_pct: kerf_pct,
        min_charge_usd,
      },
      math: {
        ext_cuin: Number(ext_cuin.toFixed(3)),
        cav_cuin: Number(cav_cuin.toFixed(3)),
        net_cuin: Number(net_cuin.toFixed(3)),
        kerf_factor: Number(kerf_factor.toFixed(4)),
        bill_cuin: Number(bill_cuin.toFixed(3)),
      },
      pricing: {
        piece_price_usd: Number(piece_price_usd.toFixed(2)),
        total_price_usd: Number(total_price_usd.toFixed(2)),
        unit_price_usd: Number(unit_price_usd.toFixed(6))
      }
    }, { status: 200, headers: { "Cache-Control": "no-store" } });

  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
