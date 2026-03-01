// app/lib/pricing/settings.ts
//
// Shared pricing settings helper.
// - Single source of truth for defaults.
// - Backed by a global object so admin API + pricing logic
//   see the same values without doing HTTP calls.

export type PricingSettings = {
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  skive_upcharge_each: number;
  printing_upcharge_usd: number;

  // Machining + markup knobs
  machining_in3_per_min: number;
  machine_cost_per_min: number;
  markup_factor_default: number;

  cushion_family_order: string[];
};

const SETTINGS_KEY = "__ALEXIO_PRICING_SETTINGS__";

function ensureDefaults(): PricingSettings {
  const g = globalThis as any;
  if (!g[SETTINGS_KEY]) {
    g[SETTINGS_KEY] = {
      ratePerCI_default: 0.06,
      ratePerBF_default: 34,
      kerf_pct_default: 0,
      min_charge_default: 0,
      skive_upcharge_each: 4.5,
      printing_upcharge_usd: 0,

      // Match your existing hard-coded compute.ts values
      machining_in3_per_min: 3000, // in³ per minute
      machine_cost_per_min: 0.65,  // $ / min
      markup_factor_default: 1.45, // 45% markup

      cushion_family_order: ["EPE", "PU", "PE", "EVA"],
    } satisfies PricingSettings;
  }
  return g[SETTINGS_KEY] as PricingSettings;
}

export function getPricingSettings(): PricingSettings {
  return ensureDefaults();
}

export function updatePricingSettings(
  partial: Partial<PricingSettings>,
): PricingSettings {
  const g = globalThis as any;
  const current = ensureDefaults();
  const next: PricingSettings = { ...current };

  for (const key of Object.keys(partial) as (keyof PricingSettings)[]) {
    (next as any)[key] = (partial as any)[key];
  }

  g[SETTINGS_KEY] = next;
  return next;
}
