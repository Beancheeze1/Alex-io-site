import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type In = {
  length_in: number | string;
  width_in: number | string;
  height_in: number | string;
  material_id: number | string;
  qty: number | string;
  cavities?: string[] | null; // e.g., ["3x3x1", "Ø6x1"]
  round_to_bf?: boolean;
};

type MaterialRow = {
  id: number;
  name: string;
  price_per_bf: number | null;
  kerf_waste_pct: number | null;
  min_charge_usd: number | null;
  price_per_cuin: number | null;
  cost_per_ci_usd: number | null;
  skiving_upcharge_pct: number | null;
  cutting_setup_fee_usd: number | null;
  thickness_in: number | null;
};

type CushionRow = {
  static_psi: any;
  deflect_pct: any;
  g_level: any;
  source: string | null;
};

/* ---------- Shared pricing settings (matches /api/admin/settings) ---------- */

const SETTINGS_KEY = "__ALEXIO_PRICING_SETTINGS__";

type PricingSettings = {
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  skive_upcharge_each: number;
  cushion_family_order?: string[];
  machining_in3_per_min?: number;
  machine_cost_per_min?: number;
  markup_factor_default?: number;
};

function getPricingSettings(): PricingSettings {
  const g = globalThis as any;
  if (!g[SETTINGS_KEY]) {
    g[SETTINGS_KEY] = {
      ratePerCI_default: 0.06,
      ratePerBF_default: 34,
      kerf_pct_default: 0,
      min_charge_default: 0,
      skive_upcharge_each: 4.5,
      cushion_family_order: ["EPE", "PU", "PE", "EVA"],
      machining_in3_per_min: 3000,
      machine_cost_per_min: 0.65,
      markup_factor_default: 1,
    } as PricingSettings;
  }
  return g[SETTINGS_KEY] as PricingSettings;
}

/* -------------------------------------------------------------------------- */

function bad(msg: string, detail?: any, code = 400) {
  return NextResponse.json({ ok: false, error: msg, detail }, { status: code });
}
function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function toNum(v: any, label: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`bad_${label}`);
  }
  return n;
}
function safeNum(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round2(v: number) {
  return Math.round(v * 100) / 100;
}
function round4(v: number) {
  return Math.round(v * 10000) / 10000;
}

/** Parse cavity strings like "2x3x0.5" or "Ø6x1" (dia x depth) into cubic inches. */
function cavityVolumeCi(s: string): number {
  const raw = s.trim().toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  if (!raw) return 0;

  // Round cavity: "ø6x1", "o6x1"
  const roundMatch = raw.match(/^([øo0]?)(\d*\.?\d+)x(\d*\.?\d+)$/i);
  if (roundMatch && roundMatch[1]) {
    const dia = Number(roundMatch[2]);
    const depth = Number(roundMatch[3]);
    if (!Number.isFinite(dia) || !Number.isFinite(depth)) return 0;
    const radius = dia / 2;
    return Math.PI * radius * radius * depth;
  }

  // Rectangular cavity: "2x3x1"
  const parts = raw.split("x").map((p) => Number(p));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] * parts[1] * parts[2];
  }

  return 0;
}

/** GET = simple help / function inspector (unchanged behavior) */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("inspect")) {
    const funcs = await q<{ schema: string; name: string; args: string }>(
      `
      SELECT n.nspname AS schema,
             p.proname AS name,
             pg_get_function_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'calc_foam_quote'
      ORDER BY 1,2;
      `,
    );

    return NextResponse.json({ ok: true, functions: funcs });
  }

  return ok({
    usage: "POST JSON to compute a foam quote",
    expects: {
      length_in: "number",
      width_in: "number",
      height_in: "number",
      material_id: "integer",
      qty: "integer",
      cavities: "string[] (optional) e.g. ['2x3x0.5','Ø6x1']",
      round_to_bf: "boolean (optional)",
    },
    example: {
      length_in: 12,
      width_in: 12,
      height_in: 3,
      material_id: 1,
      qty: 250,
      cavities: ["Ø6x1"],
      round_to_bf: false,
    },
  });
}

/**
 * POST: deterministic volumetric quote
 *
 * - Uses materials table for:
 *   - price_per_cuin / price_per_bf / cost_per_ci_usd
 *   - kerf_waste_pct (falls back to settings.kerf_pct_default)
 *   - min_charge_usd (falls back to settings.min_charge_default)
 *   - skiving_upcharge_pct (applied when thickness NOT a whole inch)
 *   - cutting_setup_fee_usd
 *
 * - Cavities subtract volume per piece.
 * - Global markup factor from /admin/settings (markup_factor_default)
 *   multiplies the raw total before min charge (default 1.0 = no change).
 * - If material has no direct pricing, machine knobs can be used as a last resort.
 * - Returns a single row in `result`.
 * - Also attaches a light-weight cushion summary when cushion_curves has data.
 */
export async function POST(req: NextRequest) {
  let body: In;
  try {
    body = (await req.json()) as In;
  } catch {
    return bad("invalid_json");
  }

  try {
    const length_in = toNum(body.length_in, "length_in");
    const width_in = toNum(body.width_in, "width_in");
    const height_in = toNum(body.height_in, "height_in");
    const qty = toNum(body.qty, "qty");
    const material_id = toNum(body.material_id, "material_id");
    const round_to_bf = !!body.round_to_bf;

    if (length_in <= 0 || width_in <= 0 || height_in <= 0) {
      return bad("dims_must_be_positive", { length_in, width_in, height_in });
    }
    if (qty <= 0) {
      return bad("qty_must_be_positive", { qty });
    }

    const cavitiesArr =
      Array.isArray(body.cavities) && body.cavities.length
        ? body.cavities.map((s) => String(s))
        : [];

    // Load material row
    const mat = await one<MaterialRow>(
      `
      SELECT
        id,
        name,
        price_per_bf,
        kerf_waste_pct,
        min_charge_usd,
        price_per_cuin,
        cost_per_ci_usd,
        skiving_upcharge_pct,
        cutting_setup_fee_usd,
        thickness_in
      FROM materials
      WHERE id = $1
      `,
      [material_id],
    );

    if (!mat) {
      return bad("material_not_found", { material_id });
    }

    // Load global pricing settings (in-memory, shared with /admin/settings)
    const settings = getPricingSettings();

    // --- Volumes (cubic inches) ---
    const piece_ci_raw = length_in * width_in * height_in;
    let cavities_ci = 0;
    for (const c of cavitiesArr) {
      cavities_ci += cavityVolumeCi(c);
    }
    const piece_ci = Math.max(piece_ci_raw - cavities_ci, 0);
    const order_ci = piece_ci * qty;

    // Kerf / waste
    const kerf_pct =
      mat.kerf_waste_pct != null
        ? safeNum(mat.kerf_waste_pct, 0)
        : safeNum(settings.kerf_pct_default, 10);
    const order_ci_with_waste = order_ci * (1 + kerf_pct / 100);

    // --- Pricing base ---
    const price_per_ci_direct = mat.price_per_cuin;
    const price_per_ci_from_bf =
      mat.price_per_bf != null ? Number(mat.price_per_bf) / 144 : null;
    const price_per_ci_from_cost =
      mat.cost_per_ci_usd != null ? Number(mat.cost_per_ci_usd) * 1.35 : null; // simple markup off cost

    // NEW: derive a per-ci rate from machine knobs if needed
    const machineRate = safeNum(settings.machining_in3_per_min, 3000);
    const machineCostPerMin = safeNum(settings.machine_cost_per_min, 0.65);
    const price_per_ci_from_machine =
      machineRate > 0 ? machineCostPerMin / machineRate : null;

    const default_price_per_ci =
      settings.ratePerCI_default ||
      (settings.ratePerBF_default ? settings.ratePerBF_default / 144 : 0.02);

    const price_per_ci =
      (price_per_ci_direct as number | null) ??
      (price_per_ci_from_bf as number | null) ??
      (price_per_ci_from_cost as number | null) ??
      (price_per_ci_from_machine as number | null) ??
      default_price_per_ci;

    const price_per_bf =
      (mat.price_per_bf as number | null) ?? round2(price_per_ci * 144);

    // Skiving upcharge: if height is NOT within 0.01 of a whole inch
    const skive_pct =
      mat.skiving_upcharge_pct != null
        ? Number(mat.skiving_upcharge_pct)
        : 0;
    const is_skived =
      Math.abs(height_in - Math.round(height_in)) > 0.01 && skive_pct > 0;

    const setup_fee =
      mat.cutting_setup_fee_usd != null
        ? Number(mat.cutting_setup_fee_usd)
        : 0;

    // Raw total (before global markup & min charge)
    let raw_total = order_ci_with_waste * price_per_ci;
    if (is_skived) {
      raw_total *= 1 + skive_pct / 100;
    }
    raw_total += setup_fee;

    // Optional board-foot rounding (same behavior as before)
    if (round_to_bf) {
      const bf = order_ci_with_waste / 144;
      const bf_rounded = Math.ceil(bf * 4) / 4; // quarter-board increments
      raw_total = bf_rounded * price_per_bf;
    }

    // Global markup factor from admin settings (default 1.0 = no change)
    const markupFactor =
      typeof settings.markup_factor_default === "number" &&
      Number.isFinite(settings.markup_factor_default) &&
      settings.markup_factor_default > 0
        ? settings.markup_factor_default
        : 1;

    raw_total *= markupFactor;

    // Min charge: material row first, then settings default
    const min_charge_source =
      mat.min_charge_usd != null
        ? mat.min_charge_usd
        : settings.min_charge_default;
    const min_charge = safeNum(min_charge_source, 0);

    let total = raw_total;
    let used_min_charge = false;
    if (min_charge > 0 && total < min_charge) {
      total = min_charge;
      used_min_charge = true;
    }

    // --- Cushion curve lookup (optional) ---
    let cushion: any = {
      has_data: false,
      point_count: 0,
    };

    try {
      const rows = await q<CushionRow>(
        `
        SELECT static_psi, deflect_pct, g_level, "source"
        FROM cushion_curves
        WHERE material_id = $1
        ORDER BY g_level ASC, static_psi ASC
        LIMIT 100;
        `,
        [material_id],
      );

      if (rows && rows.length > 0) {
        const points = rows
          .map((r) => ({
            static_psi: Number(r.static_psi),
            deflect_pct: Number(r.deflect_pct),
            g_level: Number(r.g_level),
            source: r.source || null,
          }))
          .filter(
            (p) =>
              Number.isFinite(p.static_psi) &&
              Number.isFinite(p.deflect_pct) &&
              Number.isFinite(p.g_level),
          )
          .sort((a, b) => a.g_level - b.g_level || a.static_psi - b.static_psi);

        if (points.length > 0) {
          const best = points[0];
          cushion = {
            has_data: true,
            point_count: points.length,
            best_point: best,
            points: points.slice(0, 10), // keep it light
          };
        }
      }
    } catch (err) {
      // Keep quote calc robust even if cushion table has issues
      console.error("cushion curve lookup error:", err);
    }

    const result = {
      piece_ci: round4(piece_ci),
      order_ci: round4(order_ci),
      order_ci_with_waste: round4(order_ci_with_waste),
      price_per_ci: round4(price_per_ci),
      price_per_bf: round2(price_per_bf),
      min_charge: round2(min_charge),
      total: round2(total),
      used_min_charge,

      // Extra debug / for templates
      kerf_pct,
      is_skived,
      skive_pct,
      setup_fee: round2(setup_fee),
      cavities_ci: round4(cavities_ci),
      piece_ci_raw: round4(piece_ci_raw),
      material_name: mat.name,
      markup_factor: round4(markupFactor),

      // Cushion curve summary (if available)
      cushion,
    };

    return ok({
      input: {
        length_in,
        width_in,
        height_in,
        material_id,
        qty,
        cavities: cavitiesArr,
        round_to_bf,
      },
      variant_used: "ts_volumetric_v1",
      result,
    });
  } catch (e: any) {
    return bad("calc_exception", { message: String(e?.message || e) }, 500);
  }
}
