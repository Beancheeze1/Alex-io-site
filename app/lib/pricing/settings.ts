// app/lib/pricing/settings.ts
//
// Tenant-scoped pricing settings.
// Each tenant's settings are stored under separate KV and memory-cache keys.
// Changing Tenant A's settings has zero effect on Tenant B.
//
// Step 22: the memory cache expires after 30 s, so a save on one server
// instance reaches every instance within 30 s (it used to be cached forever).
// Settings are keyed by the numeric shop id (the admin page saves under it).

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

  // Die-cutting upcharge: flat fee applied once order qty reaches the trigger.
  // Off by default (upcharge 0) so this never silently starts charging
  // existing quotes until an admin explicitly sets both values.
  die_cut_trigger_qty: number;
  die_cut_upcharge_usd: number;

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

  die_cut_trigger_qty: 500,
  die_cut_upcharge_usd: 0,

  cushion_family_order: ["EPE", "PU", "PE", "EVA"],
};

const CACHE_TTL_MS = 30_000;
type CacheEntry = { at: number; value: PricingSettings };

// Keys are scoped per tenant
function memKey(tenantId: number | string): string {
  return `__ALEXIO_PRICING_SETTINGS_${tenantId}__`;
}
function kvKey(tenantId: number | string): string {
  return `alexio:pricing_settings:${tenantId}`;
}

function getMemEntry(tenantId: number | string): CacheEntry | null {
  const e = (globalThis as any)[memKey(tenantId)];
  return e && typeof e === "object" && "value" in e && "at" in e ? (e as CacheEntry) : null;
}
/** A cached value younger than the TTL, or null. */
function getMemCache(tenantId: number | string): PricingSettings | null {
  const e = getMemEntry(tenantId);
  return e && Date.now() - e.at < CACHE_TTL_MS ? e.value : null;
}
function setMemCache(tenantId: number | string, s: PricingSettings): void {
  (globalThis as any)[memKey(tenantId)] = { at: Date.now(), value: s } satisfies CacheEntry;
}
function mergeWithDefaults(raw: Partial<PricingSettings>): PricingSettings {
  return { ...DEFAULTS, ...raw };
}

/**
 * Async — loads from KV, cached in memory for 30 s per tenant.
 * Pass the numeric shop id.
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
    // KV unavailable — keep the last known settings for this shop if any,
    // rather than silently switching to the defaults.
    const stale = getMemEntry(tenantId);
    if (stale) return stale.value;
  }

  const defaults = mergeWithDefaults({});
  setMemCache(tenantId, defaults);
  return defaults;
}

/**
 * Sync — returns the last cached settings for this tenant (even if older than
 * the TTL), else defaults. Prefer getPricingSettings() (async).
 */
export function getPricingSettingsSync(tenantId: number | string = "default"): PricingSettings {
  return getMemEntry(tenantId)?.value ?? mergeWithDefaults({});
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
