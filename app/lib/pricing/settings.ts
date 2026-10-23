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
import { FREIGHT_DEFAULTS, type FreightSettings } from "@/app/lib/freight-core";

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

  // Step 23: foam cutting + lamination (app/lib/pricing/foam-process.ts).
  // All are the shop's COST (the markup is applied); 0 = not used. While no
  // CNC or die rates are set, the flat die-cut fee above still applies.
  foam_die_over_qty: number; // auto: steel-rule die at or above this qty
  cnc_setup_usd: number;
  cnc_feed_in_per_min: number;
  cnc_cost_per_min: number;
  die_base_usd: number;
  die_rule_per_in_usd: number;
  press_setup_usd: number;
  press_rate_per_hr: number;
  press_hits_per_hr: number;
  press_parts_per_hit: number;
  lam_setup_usd: number;
  lam_per_glue_line_usd: number;
  // Step 39L: stock sheet thicknesses laminated into parts (0 = not used)
  foam_stock_1_in: number;
  foam_stock_2_in: number;
  foam_stock_3_in: number;
  foam_stock_4_in: number;

  // Step 25: review flags (app/lib/pricing/foam-review.ts) — warnings only.
  foam_min_wall_in: number; // thinnest foam wall at an edge / between cavities
  foam_min_feature_in: number; // narrowest cavity
  foam_max_block_l_in: number; // largest block / bun (0 = don't check)
  foam_max_block_w_in: number;
  foam_max_block_t_in: number;

  // Step 28: quote terms (app/lib/quote-approval-core.ts).
  quote_valid_days: number; // estimates expire after this many days (0 = never)
  lead_time_text: string; // e.g. "3-4 weeks after approval" ("" = not shown)

  // Step 29A: buyer status emails (app/lib/quote-mail.ts).
  buyer_email_accepted: boolean; // "we received your approval"
  buyer_email_confirmed: boolean; // "your order is confirmed"
  buyer_email_released: boolean; // "your order is in production"
  buyer_email_shipped: boolean; // Step 34A: "your order has shipped"
  reply_to_email: string; // replies go here ("" = the quote's sales rep, else the shop page email)

  // Step 29B: reminders (app/lib/reminders.ts, run hourly by GitHub Actions).
  reminder_expiring_on: boolean; // buyer: "your quote expires soon"
  reminder_expiring_days: number; // ... this many days before it expires
  reminder_followup_on: boolean; // buyer: "any questions?" when they haven't accepted
  reminder_followup_days: number; // ... this many days after the quote email
  staff_digest_on: boolean; // staff: one daily email (to confirm, new, expiring)
  staff_digest_hour: number; // 0-23, shop time
  staff_digest_to: string; // "" = every admin user of the shop
  shop_timezone: string; // IANA name, e.g. "America/New_York"

  // Step 30: ship-from ZIP, freight terms and the weight / zone freight
  // table (app/lib/freight-core.ts; cleaned with cleanFreightSettings()).
  freight: FreightSettings;

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

  foam_die_over_qty: 0,
  cnc_setup_usd: 0,
  cnc_feed_in_per_min: 0,
  cnc_cost_per_min: 0,
  die_base_usd: 0,
  die_rule_per_in_usd: 0,
  press_setup_usd: 0,
  press_rate_per_hr: 0,
  press_hits_per_hr: 0,
  press_parts_per_hit: 1,
  lam_setup_usd: 0,
  lam_per_glue_line_usd: 0,
  foam_stock_1_in: 0,
  foam_stock_2_in: 0,
  foam_stock_3_in: 0,
  foam_stock_4_in: 0,

  foam_min_wall_in: 0.25,
  foam_min_feature_in: 0.25,
  foam_max_block_l_in: 0,
  foam_max_block_w_in: 0,
  foam_max_block_t_in: 0,

  quote_valid_days: 30,
  lead_time_text: "",

  buyer_email_accepted: true,
  buyer_email_confirmed: true,
  buyer_email_released: true,
  buyer_email_shipped: true,
  reply_to_email: "",

  reminder_expiring_on: true,
  reminder_expiring_days: 5,
  reminder_followup_on: true,
  reminder_followup_days: 3,
  staff_digest_on: true,
  staff_digest_hour: 7,
  staff_digest_to: "",
  shop_timezone: "America/New_York",

  freight: FREIGHT_DEFAULTS,

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
