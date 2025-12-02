// app/api/admin/settings/route.ts
//
// Runtime pricing knobs for the engine + breakdown.
// Stored in globalThis for the current server process.
// Path A safe: no DB writes, just in-memory settings.
//
// Exposed settings:
//  - ratePerCI_default        ($ / cubic inch baseline)
//  - ratePerBF_default        ($ / board foot baseline)
//  - kerf_pct_default         (default kerf/waste %)
//  - min_charge_default       (default min charge $)
//  - skive_upcharge_each      ($/piece for non-1" thickness)
//  - cushion_family_order     (advisor material priority)
//  - machine_rate_in3_per_min (machine throughput in³ / minute)
//  - machine_cost_per_min     (machine cost $ / minute)
//  - default_markup_factor    (markup multiplier over cost, e.g. 1.45)

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PricingSettings = {
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  skive_upcharge_each: number;
  cushion_family_order?: string[];

  machine_rate_in3_per_min: number;
  machine_cost_per_min: number;
  default_markup_factor: number;
};

function getSettings(): PricingSettings {
  const key = "__ALEXIO_PRICING_SETTINGS__";
  const g = globalThis as any;

  if (!g[key]) {
    g[key] = {
      ratePerCI_default: 0.06,
      ratePerBF_default: 34,
      kerf_pct_default: 0,
      min_charge_default: 0,
      skive_upcharge_each: 4.5,
      cushion_family_order: ["EPE", "PU", "PE", "EVA"],

      // Defaults previously hard-coded in compute.ts
      machine_rate_in3_per_min: 3000,
      machine_cost_per_min: 0.65,
      default_markup_factor: 1.45,
    } satisfies PricingSettings;
  }

  return g[key] as PricingSettings;
}

export async function GET() {
  return NextResponse.json(
    { ok: true, settings: getSettings() },
    { status: 200 },
  );
}

/**
 * PATCH body accepts any subset of PricingSettings:
 * {
 *   "skive_upcharge_each": 4.50,
 *   "ratePerCI_default": 0.06,
 *   "ratePerBF_default": 34,
 *   "kerf_pct_default": 10,
 *   "min_charge_default": 25,
 *   "cushion_family_order": ["EPE","PU","PE","EVA"],
 *   "machine_rate_in3_per_min": 3000,
 *   "machine_cost_per_min": 0.65,
 *   "default_markup_factor": 1.45
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const s = getSettings();
    const body = (await req.json()) as Partial<PricingSettings>;

    const keys: (keyof PricingSettings)[] = [
      "skive_upcharge_each",
      "ratePerCI_default",
      "ratePerBF_default",
      "kerf_pct_default",
      "min_charge_default",
      "cushion_family_order",
      "machine_rate_in3_per_min",
      "machine_cost_per_min",
      "default_markup_factor",
    ];

    for (const k of keys) {
      if (k in body) {
        (s as any)[k] = (body as any)[k];
      }
    }

    (globalThis as any).__ALEXIO_PRICING_SETTINGS__ = s;

    return NextResponse.json(
      { ok: true, settings: s },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 400 },
    );
  }
}
