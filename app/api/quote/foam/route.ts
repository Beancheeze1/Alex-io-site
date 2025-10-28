// app/api/quote/foam/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
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

type Cavity = { label?: string; count?: number; l: number | string; w: number | string; d: number | string };

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return NaN;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

async function parseBody(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get("content-type") || "";
  // 1) Try JSON first
  try {
    const j = await req.json();
    if (j && typeof j === "object") return j as any;
  } catch {}
  // 2) Try text -> JSON
  try {
    const txt = await req.text();
    if (txt) {
      try {
        const j = JSON.parse(txt);
        if (j && typeof j === "object") return j as any;
      } catch {
        // 3) Try URLSearchParams (application/x-www-form-urlencoded)
        const p = new URLSearchParams(txt);
        if ([...p.keys()].length) {
          const obj: any = {};
          p.forEach((v, k) => (obj[k] = v));
          return obj;
        }
      }
    }
  } catch {}
  return {};
}

export async function POST(req: Request) {
  const pool = getPool();
  try {
    const raw = await parseBody(req);

    // Accept either top-level or nested under "data"
    const body = typeof raw === "object" && raw && "data" in raw ? (raw as any).data : raw;

    const length_in = num((body as any).length_in);
    const width_in  = num((body as any).width_in);
    const height_in = num((body as any).height_in);
    const material_id = Math.trunc(num((body as any).material_id));
    const qty = Math.max(1, Math.trunc(num((body as any).qty ?? 1)));
    const round_to_bf = num((body as any).round_to_bf ?? 0.10) || 0.10;

    // Cavities: allow strings; coerce
    let cavities: Cavity[] = [];
    if (Array.isArray((body as any).cavities)) {
      cavities = (body as any).cavities as Cavity[];
    } else if (typeof (body as any).cavities === "string") {
      try { cavities = JSON.parse((body as any).cavities); } catch {}
    }

    cavities = (cavities || [])
      .map((c) => ({
        label: c?.label,
        count: Math.max(1, Math.trunc(num((c as any).count ?? 1))),
        l: num((c as any).l),
        w: num((c as any).w),
        d: num((c as any).d),
      }))
      .filter((c) => [c.l, c.w, c.d].every((v) => v > 0) && c.count > 0) as any;

    // Validation (loose but safe)
    const badDims = ![length_in, width_in, height_in].every((v) => Number.isFinite(v) && v > 0);
    if (badDims) {
      return NextResponse.json(
        { error: "length_in, width_in, height_in must be > 0", got: { length_in, width_in, height_in, body } },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (!Number.isFinite(material_id) || material_id <= 0) {
      return NextResponse.json(
        { error: "material_id must be a positive integer", got: { material_id } },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (!(round_to_bf > 0)) {
      return NextResponse.json(
        { error: "round_to_bf must be > 0", got: { round_to_bf } },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const cavitiesJson = JSON.stringify(cavities);

    const { rows } = await pool.query(
      `SELECT public.calc_foam_quote($1,$2,$3,$4,$5,$6::jsonb,$7) AS result`,
      [length_in, width_in, height_in, material_id, qty, cavitiesJson, round_to_bf]
    );

    return NextResponse.json(rows[0]?.result ?? {}, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    const msg = (err?.message || "").toString();
    console.error("POST /api/quote/foam error:", err);
    const code = msg.includes("Cavity volume") || msg.includes("All dimensions") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: code, headers: { "Cache-Control": "no-store" } });
  }
}
