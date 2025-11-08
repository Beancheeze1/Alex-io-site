// app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PricingSettings = {
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  skive_upcharge_each: number;
  cushion_family_order?: string[]; // keep optional, present in both files
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
    } satisfies PricingSettings;
  }
  return g[key] as PricingSettings;
}

export async function GET() {
  return NextResponse.json({ ok: true, settings: getSettings() }, { status: 200 });
}

/**
 * PATCH body accepts any subset of PricingSettings:
 * {
 *   "skive_upcharge_each": 4.50,
 *   "ratePerCI_default": 0.06,
 *   "ratePerBF_default": 34,
 *   "kerf_pct_default": 10,
 *   "min_charge_default": 25,
 *   "cushion_family_order": ["EPE","PU","PE","EVA"]
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
    ];

    for (const k of keys) {
      if (k in body) {
        (s as any)[k] = (body as any)[k];
      }
    }

    // save back
    (globalThis as any).__ALEXIO_PRICING_SETTINGS__ = s;

    return NextResponse.json({ ok: true, settings: s }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 400 });
  }
}
