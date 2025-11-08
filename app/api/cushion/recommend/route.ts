// app/api/ai/cushion/recommend/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/ai/cushion/recommend
 * Body (examples):
 * {
 *   "family": "PE",               // required (PE, EPE, PU, etc.)
 *   "weight_lb": 12.5,           // required (item weight)
 *   "drop_in": 24,               // drop height (inches) or null
 *   "target_g": 40,              // desired max G (optional)
 *   "deflection_pct": 10,        // target static deflection %, optional
 *   "dims": { "L":12, "W":9, "H":2, "units":"in" }, // optional, used for area/stress
 *   "qty": 1                      // optional
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   usedDb: boolean,
 *   recommended_density: number,
 *   suggested_material: string | null,
 *   diag: any
 * }
 */

type Dims = { L: number; W: number; H: number; units?: "in" | "mm" };

function toInches(n: number, units?: string) {
  if (!Number.isFinite(n)) return 0;
  return (units === "mm") ? n / 25.4 : n;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const family = String(body.family || "").trim().toUpperCase();
    const weight_lb = Number(body.weight_lb ?? NaN);
    const drop_in = body.drop_in == null ? null : Number(body.drop_in);
    const target_g = body.target_g == null ? null : Number(body.target_g);
    const deflection_pct = body.deflection_pct == null ? null : Number(body.deflection_pct);
    const qty = Number.isFinite(Number(body.qty)) ? Number(body.qty) : 1;

    const dims: Dims | null = body.dims
      ? {
          L: Number(body.dims.L ?? 0),
          W: Number(body.dims.W ?? 0),
          H: Number(body.dims.H ?? 0),
          units: (body.dims.units === "mm" ? "mm" : "in"),
        }
      : null;

    if (!family) {
      return NextResponse.json({ ok: false, error: "family_required" }, { status: 400 });
    }
    if (!Number.isFinite(weight_lb) || weight_lb <= 0) {
      return NextResponse.json({ ok: false, error: "weight_lb_invalid" }, { status: 400 });
    }

    // --- Try DB-first if you have a JSONB-based recommender function
    //     e.g., SELECT * FROM recommend_cushion($1::jsonb)
    //     This preserves your prior DB-based design if present.
    let usedDb = false;
    let dbResult: any = null;

    try {
      // Lazy import to avoid bundling issues in edge runtimes, though we are nodejs here.
      // Adapt this import if your project uses a different DB client (neon/postgres/etc).
      // We wrap in try/catch so the route still works without DB function.
      // @ts-ignore
      const { default: runDb } = await import("@/app/lib/db_call_optional").catch(() => ({ default: null }));
      if (runDb) {
        const payload = {
          family,
          weight_lb,
          drop_in,
          target_g,
          deflection_pct,
          qty,
          dims,
        };
        // This helper should return { rows: [...] } or null; it's a thin wrapper you can add:
        // export default async function runDb(sql: string, args: any[]): Promise<{rows:any[]}|null> { ... }
        dbResult = await runDb(
          "select * from recommend_cushion($1::jsonb)",
          [JSON.stringify(payload)]
        );
        if (dbResult && Array.isArray(dbResult.rows) && dbResult.rows.length) {
          usedDb = true;
          const r = dbResult.rows[0];
          return NextResponse.json({
            ok: true,
            usedDb,
            recommended_density: Number(r.recommended_density ?? 0),
            suggested_material: r.suggested_material ?? null,
            diag: { db: "recommend_cushion", row: r },
          });
        }
      }
    } catch (_) {
      // swallow; fallback below
    }

    // --- Fallback heuristic (keeps you moving even without DB function)
    // Very simple educated guess:
    // - Compute footprint area; estimate static stress; choose density tiers.
    // - If target_g lower (more protection), bias to higher density within family.
    const L_in = dims ? toInches(dims.L, dims.units) : 0;
    const W_in = dims ? toInches(dims.W, dims.units) : 0;
    const H_in = dims ? toInches(dims.H, dims.units) : 0;

    const footprint = Math.max(0.01, L_in * W_in); // in^2
    const static_stress = weight_lb / footprint;   // lb/in^2 (psi-ish)

    // Family density bands — tweak as needed or replace with your curated table.
    const bands: Record<string, number[]> = {
      "PE":  [1.3, 1.7, 2.2, 4.0],
      "EPE": [1.3, 1.7, 2.2],
      "PU":  [1.2, 1.5, 1.7, 2.0],
    };
    const candidates = bands[family] ?? [1.7];

    // Very rough mapping from stress & drop/target_g to density index.
    let idx = 0;
    if (static_stress > 0.08) idx++;
    if (static_stress > 0.15) idx++;
    if (target_g != null && target_g <= 35) idx++; // tighter G => slightly stiffer

    idx = clamp(idx, 0, candidates.length - 1);
    const recommended_density = candidates[idx];

    return NextResponse.json({
      ok: true,
      usedDb,
      recommended_density,
      suggested_material: `${family} ${recommended_density.toFixed(1)}#`,
      diag: {
        static_stress,
        target_g,
        drop_in,
        H_in,
        qty,
        family,
        note: usedDb ? "db" : "heuristic_fallback",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
