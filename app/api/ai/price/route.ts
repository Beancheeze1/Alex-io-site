// app/api/ai/price/route.ts
import { NextRequest, NextResponse } from "next/server";
import pg from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PriceInput = {
  dims: { L: number; W: number; H: number; units?: "in" | "mm" };
  qty: number;
  materialId: number;
  cavities?: number;
  round_to_bf?: boolean;
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
  return (dims?.units || "in") === "mm"
    ? { L: L / 25.4, W: W / 25.4, H: H / 25.4 }
    : { L, W, H };
}

export async function POST(req: NextRequest) {
  const diag: Record<string, any> = {};
  try {
    const body = (await req.json()) as Partial<PriceInput>;
    const qty = toNum(body?.qty);
    const materialId = toNum(body?.materialId);
    const cavities = toNum(body?.cavities ?? 0) ?? 0;
    const roundToBF = !!body?.round_to_bf;
    const dimsInches = normalizeToInches(body?.dims ?? ({} as any));

    if (!dimsInches || !qty || !materialId) {
      return NextResponse.json(
        { ok: false, error: "missing/invalid dims, qty, or materialId" },
        { status: 400 }
      );
    }

    const cn = process.env.DATABASE_URL;
    if (!cn) {
      return NextResponse.json(
        { ok: false, error: "Missing env DATABASE_URL" },
        { status: 500 }
      );
    }

    const pool = new pg.Pool({ connectionString: cn, ssl: { rejectUnauthorized: false } });

    // ✅ FIX: remove column definition list; just select from the function
    const sql = `
      select * 
      from calc_foam_quote($1,$2,$3,$4,$5,$6,$7)
      limit 1
    `;
    const args = [
      dimsInches.L,
      dimsInches.W,
      dimsInches.H,
      materialId,
      qty,
      cavities,
      roundToBF,
    ];

    const { rows } = await pool.query(sql, args);
    await pool.end();

    if (!rows?.length) {
      return NextResponse.json(
        { ok: false, error: "calc_foam_quote returned no rows", diag },
        { status: 500 }
      );
    }

    // Try a few common field names
    const r = rows[0] as any;
    const each =
      toNum(r.each) ??
      toNum(r.unit_price) ??
      toNum(r.price_each) ??
      toNum(r.unit);
    const extended =
      toNum(r.extended) ??
      toNum(r.total) ??
      (each != null ? each * qty : null);

    return NextResponse.json(
      {
        ok: each != null && extended != null,
        each: Number(each ?? 0),
        extended: Number(extended ?? 0),
        min_charge:
          r.min_charge != null ? Number(r.min_charge) : undefined,
        kerf_pct: r.kerf_pct != null ? Number(r.kerf_pct) : undefined,
        notes: r.notes ?? undefined,
        diag,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "price error" },
      { status: 500 }
    );
  }
}
