// app/lib/pricing/settings.ts
//
// Shared pricing settings helper.
// - Single source of truth for defaults.
// - In-memory cache backed by KV (Upstash/Redis) so settings survive
//   server restarts and serverless cold-starts.
// - Falls back to in-memory only when KV is not configured.

import { makeKv } from "@/app/lib/kv";

export type PricingSettings = {
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  skive_upcharge_each: number;
  printing_upcharge_usd: number;   // flat "Art Setup" fee
  printing_upcharge_pct: number;   // % of (foam + packaging) subtotal when printed

  // Machining + markup knobs
  machining_in3_per_min: number;
  machine_cost_per_min: number;
  markup_factor_default: number;

  cushion_family_order: string[];
};

const SETTINGS_KEY = "__ALEXIO_PRICING_SETTINGS__";
const KV_KEY = "alexio:pricing_settings";

const DEFAULTS: PricingSettings = {
  ratePerCI_default: 0.06,
  ratePerBF_default: 34,
  kerf_pct_default: 0,
  min_charge_default: 0,
  skive_upcharge_each: 4.5,
  printing_upcharge_usd: 0,
  printing_upcharge_pct: 0,

  machining_in3_per_min: 3000,
  machine_cost_per_min: 0.65,
  markup_factor_default: 1.45,

  cushion_family_order: ["EPE", "PU", "PE", "EVA"],
};

function getMemCache(): PricingSettings | null {
  const g = globalThis as any;
  return g[SETTINGS_KEY] ?? null;
}

function setMemCache(s: PricingSettings): void {
  (globalThis as any)[SETTINGS_KEY] = s;
}

function mergeWithDefaults(raw: Partial<PricingSettings>): PricingSettings {
  return { ...DEFAULTS, ...raw };
}

/**
 * Async version — loads from KV on first call, caches in memory.
 * Used in route handlers where await is available.
 */
export async function getPricingSettings(): Promise<PricingSettings> {
  const cached = getMemCache();
  if (cached) return cached;

  try {
    const kv = makeKv();
    const raw = await kv.get(KV_KEY);
    if (raw) {
      const parsed = mergeWithDefaults(JSON.parse(raw) as Partial<PricingSettings>);
      setMemCache(parsed);
      return parsed;
    }
  } catch {
    // KV unavailable — fall through to defaults
  }

  const defaults = mergeWithDefaults({});
  setMemCache(defaults);
  return defaults;
}

/**
 * Sync version for code paths that can't await (e.g. compute.ts).
 * Returns the in-memory cache if warm, otherwise returns defaults.
 * For fresh serverless instances, call getPricingSettings() (async) first.
 */
export function getPricingSettingsSync(): PricingSettings {
  return getMemCache() ?? mergeWithDefaults({});
}

/**
 * Update settings in both memory cache and KV.
 */
export async function updatePricingSettings(
  partial: Partial<PricingSettings>,
): Promise<PricingSettings> {
  const current = await getPricingSettings();
  const next: PricingSettings = { ...current };

  for (const key of Object.keys(partial) as (keyof PricingSettings)[]) {
    (next as any)[key] = (partial as any)[key];
  }

  setMemCache(next);

  try {
    const kv = makeKv();
    await kv.set(KV_KEY, JSON.stringify(next));
  } catch {
    // KV unavailable — settings saved in-memory only for this instance
  }

  return next;
}