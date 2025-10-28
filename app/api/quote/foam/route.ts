// app/api/quote/foam/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing env: DATABASE_URL");
    _pool = new Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

type Cavity = { label?: string; count?: number; l: number; w: number; d: number };

function asNumber(n: unknown) {
  const num = typeof n === "string" ? Number(n) : (n as number);
  return Number.isFinite(num) ? num : NaN;
}

export async function POST(req: Request) {
  const pool = getPool();
  try {
    const body = await req.json().catch(() => ({}));

    const length_in = asNumber(body.length_in);
    const width_in  = asNumber(body.width_in);
    const height_in = asNumber(body.height_in);
    const material_id = Number(body.material_id);
    const qty = Number(body.qty ?? 1);
    const round_to_bf = body.round_to_bf != null ? asNumber(body.round_to_bf) : 0.10;

    // Basic validation (no zod to keep deps minimal)
    if (![length_in, width_in, height_in].every((v) => v > 0)) {
      return NextResponse.json({ error: "length_in, width_in, height_in must be > 0" }, { status: 400 });
    }
    if (!Number.isInteger(material_id) || material_id <= 0) {
      return NextResponse.json({ error: "material_id must be a positive integer" }, { status: 400 });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json({ error: "qty must be a positive integer" }, { status: 400 });
    }
    if (!(round_to_bf > 0)) {
      return NextResponse.json({ error: "round_to_bf must be > 0" }, { status: 400 });
    }

    let cavities: Cavity[] = Array.isArray(body.cavities) ? body.cavities : [];
    // Scrub/shape cavities array minimally
    cavities = cavities
      .map((c) => ({
        label: c?.label,
        count: Number.isFinite(c?.count) ? Number(c!.count) : 1,
        l: asNumber(c?.l),
        w: asNumber(c?.w),
        d: asNumber(c?.d),
      }))
      .filter((c) => [c.l, c.w, c.d].every((v) => v > 0) && (c.count ?? 1) > 0);

    const cavitiesJson = JSON.stringify(cavities);

    // Call the DB function verbatim; it returns JSON
    const { rows } = await pool.query(
      `SELECT public.calc_foam_quote($1,$2,$3,$4,$5,$6::jsonb,$7) AS result`,
      [length_in, width_in, height_in, material_id, qty, cavitiesJson, round_to_bf]
    );

    return NextResponse.json(rows[0]?.result ?? {}, { status: 200 });
  } catch (err: any) {
    // Surface DB validation errors (e.g., cavity > ext volume)
    const msg = (err?.message || "").toString();
    const code = msg.includes("Cavity volume") || msg.includes("All dimensions")
      ? 400
      : 500;
    console.error("POST /api/quote/foam error:", err);
    return NextResponse.json({ error: msg || "Quote failed" }, { status: code });
  }
}
