// app/api/ai/price/route.ts
import { NextRequest, NextResponse } from "next/server";
import pg from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PriceInput = {
  // dims may be inches or mm (see units)
  dims: { L: number; W: number; H: number; units?: "in" | "mm" };
  qty: number;
  materialId: number;          // required for DB function
  cavities?: number;           // optional (defaults 0)
  round_to_bf?: boolean;       // optional (defaults false)
};

type PriceOut = {
  ok: boolean;
  each: number;
  extended: number;
  min_charge?: number;
  kerf_pct?: number;
  notes?: string;
  diag?: any;
};

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeToInches(dims: PriceInput["dims"]) {
  const L = toNum(dims?.L);
  const W = toNum(dims?.W);
  const H = toNum(dims?.H);
  if (!L || !W || !H) return null;
  if ((dims?.units || "in") === "mm") {
    return { L: L / 25.4, W: W / 25.4, H: H / 25.4 };
  }
  return { L, W, H };
}

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

export async function POST(req: NextRequest) {
  const diag: Record<string, any> = {};
  try {
    const body = (await req.json()) as Partial<PriceInput>;
    const dimsIn = body?.dims ?? ({} as any);
    const qty = toNum(body?.qty);
    const materialId = toNum(body?.materialId);
    const cavities = toNum(body?.cavities ?? 0) ?? 0;
    const roundToBF = !!body?.round_to_bf;

    const dimsInches = normalizeToInches(dimsIn);
    if (!dimsInches || !qty || !materialId) {
      return NextResponse.json(
        { ok: false, error: "missing/invalid dims, qty, or materialId" },
        { status: 400 }
      );
    }

    diag.in = { dimsIn, dimsInches, qty, materialId, cavities, roundToBF };

    // Connect to Postgres
    const cn = process.env.DATABASE_URL;
    if (!cn) {
      return NextResponse.json(
        { ok: false, error: "Missing env DATABASE_URL" },
        { status: 500 }
      );
    }

    const pool = new pg.Pool({ connectionString: cn, ssl: { rejectUnauthorized: false } });
    let row: any | null = null;

    // Call your pricing function:
    // calc_foam_quote(length_in, width_in, height_in, material_id, qty, cavities, round_to_bf)
    const sql =
      "select * from calc_foam_quote($1,$2,$3,$4,$5,$6,$7) as t(" +
      "each numeric, extended numeric, min_charge numeric, kerf_pct numeric, notes text);";

    const { rows } = await pool.query(sql, [
      dimsInches.L,
      dimsInches.W,
      dimsInches.H,
      materialId,
      qty,
      cavities,
      roundToBF,
    ]);
    row = rows?.[0] ?? null;
    await pool.end();

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "calc_foam_quote returned no rows", diag },
        { status: 500 }
      );
    }

    const res: PriceOut = {
      ok: true,
      each: Number(row.each ?? 0),
      extended: Number(row.extended ?? 0),
      min_charge: row.min_charge != null ? Number(row.min_charge) : undefined,
      kerf_pct: row.kerf_pct != null ? Number(row.kerf_pct) : undefined,
      notes: row.notes ?? undefined,
      diag,
    };

    return NextResponse.json(res, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "price error" },
      { status: 500 }
    );
  }
}
