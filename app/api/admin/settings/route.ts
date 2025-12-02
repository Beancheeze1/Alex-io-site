// app/api/admin/settings/route.ts
//
// Admin-facing pricing settings API.
// Backed by the shared helper in app/lib/pricing/settings.ts
// so the admin UI and pricing engine see the same values.

import { NextRequest, NextResponse } from "next/server";
import {
  getPricingSettings,
  updatePricingSettings,
  PricingSettings,
} from "../../../lib/pricing/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SettingsResponse = {
  ok: boolean;
  settings: PricingSettings;
};

export async function GET() {
  const settings = getPricingSettings();
  const payload: SettingsResponse = { ok: true, settings };
  return NextResponse.json(payload, { status: 200 });
}

/**
 * PATCH body accepts any subset of PricingSettings:
 * {
 *   "skive_upcharge_each": 4.50,
 *   "ratePerCI_default": 0.06,
 *   "ratePerBF_default": 34,
 *   "kerf_pct_default": 10,
 *   "min_charge_default": 25,
 *   "machining_in3_per_min": 3000,
 *   "machine_cost_per_min": 0.65,
 *   "markup_factor_default": 1.45,
 *   "cushion_family_order": ["EPE","PU","PE","EVA"]
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PricingSettings>;

    const keys: (keyof PricingSettings)[] = [
      "skive_upcharge_each",
      "ratePerCI_default",
      "ratePerBF_default",
      "kerf_pct_default",
      "min_charge_default",
      "machining_in3_per_min",
      "machine_cost_per_min",
      "markup_factor_default",
      "cushion_family_order",
    ];

    const filtered: Partial<PricingSettings> = {};
    for (const k of keys) {
      if (k in body) {
        (filtered as any)[k] = (body as any)[k];
      }
    }

    const settings = updatePricingSettings(filtered);
    return NextResponse.json(
      { ok: true, settings },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 400 },
    );
  }
}
