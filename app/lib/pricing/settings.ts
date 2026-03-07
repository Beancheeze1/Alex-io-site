// app/lib/pricing/settings.ts
//
// Tenant-scoped pricing settings.
// Each tenant's settings are stored under separate KV and memory-cache keys.
// Changing Tenant A's settings has zero effect on Tenant B.

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

// Keys are scoped per tenant
function memKey(tenantId: number | string): string {
  return `__ALEXIO_PRICING_SETTINGS_${tenantId}__`;
}
function kvKey(tenantId: number | string): string {
  return `alexio:pricing_settings:${tenantId}`;
}

function getMemCache(tenantId: number | string): PricingSettings | null {
  return (globalThis as any)[memKey(tenantId)] ?? null;
}
function setMemCache(tenantId: number | string, s: PricingSettings): void {
  (globalThis as any)[memKey(tenantId)] = s;
}
function mergeWithDefaults(raw: Partial<PricingSettings>): PricingSettings {
  return { ...DEFAULTS, ...raw };
}

/**
 * Async — loads from KV on first call per tenant, then caches in memory.
 * Pass tenantId (number or string) from the authenticated user.
 */
export async function getPricingSettings(tenantId: number | string = "default"): Promise<PricingSettings> {
  const cached = getMemCache(tenantId);
  if (cached) return cached;

  try {
    const kv = makeKv();
    const raw = await kv.get(kvKey(tenantId));
    if (raw) {
      const parsed = mergeWithDefaults(JSON.parse(raw) as Partial<PricingSettings>);
      setMemCache(tenantId, parsed);
      return parsed;
    }
  } catch {
    // KV unavailable — fall through to defaults
  }

  const defaults = mergeWithDefaults({});
  setMemCache(tenantId, defaults);
  return defaults;
}

/**
 * Sync — returns in-memory cache for this tenant if warm, else defaults.
 * For fresh serverless instances call getPricingSettings() (async) first.
 */
export function getPricingSettingsSync(tenantId: number | string = "default"): PricingSettings {
  return getMemCache(tenantId) ?? mergeWithDefaults({});
}

/**
 * Update settings in both memory cache and KV for the given tenant.
 */
export async function updatePricingSettings(
  partial: Partial<PricingSettings>,
  tenantId: number | string = "default",
): Promise<PricingSettings> {
  const current = await getPricingSettings(tenantId);
  const next: PricingSettings = { ...current };

  for (const key of Object.keys(partial) as (keyof PricingSettings)[]) {
    (next as any)[key] = (partial as any)[key];
  }

  setMemCache(tenantId, next);

  try {
    const kv = makeKv();
    await kv.set(kvKey(tenantId), JSON.stringify(next));
  } catch {
    // KV unavailable — settings saved in-memory only for this instance
  }

  return next;
}
