// lib/shop-page-edit.ts
//
// Step 45: a shop's admins edit their own Quotes & ordering page
// (Shop settings → Shop page). These are the theme_json fields they may
// change, with the same limits the page itself applies when it reads them
// (lib/tenant-page.ts). The shop's name, address (slug), plan, active status
// stay with the platform owner (Admin → Tenants).
// Step 47: shops also pick what buyers can quote online (their quote types:
// Foam insert, Complete Pack, Boxes and Displays). That switches the quoting
// tools on and off, and the page's product tiles follow it. The old separate
// tile list (theme_json.products) is no longer edited or used.
// Pure (tested in scripts/test-shop-page-edit.ts).

import { QUOTE_TYPE_KEYS, quoteTypesFromTheme, type QuoteTypeKey } from "@/lib/quote-types";

type TextSpec = { kind: "text"; max: number; label: string };
type UrlSpec = { kind: "url"; label: string };
type EmailSpec = { kind: "email"; label: string };
type HexSpec = { kind: "hex"; label: string };
type BoolSpec = { kind: "bool"; label: string };
type FieldSpec = TextSpec | UrlSpec | EmailSpec | HexSpec | BoolSpec;

export const SHOP_PAGE_FIELDS = {
  logoUrl: { kind: "url", label: "Logo" },
  heroUseLogo: { kind: "bool", label: "Show the logo in the header" },
  primaryColor: { kind: "hex", label: "Button color" },
  secondaryColor: { kind: "hex", label: "Bar and footer color" },
  tagline: { kind: "text", max: 120, label: "Tagline" },
  heroImageUrl: { kind: "url", label: "Banner photo" },
  heroCaption: { kind: "text", max: 120, label: "Banner photo caption" },
  quoteIntro: { kind: "text", max: 300, label: "Banner intro" },
  quoteScope: { kind: "text", max: 120, label: "What buyers can quote online" },
  aboutText: { kind: "text", max: 1200, label: "About text" },
  websiteUrl: { kind: "url", label: "Main website" },
  phone: { kind: "text", max: 40, label: "Phone" },
  email: { kind: "email", label: "Public contact email" },
  address: { kind: "text", max: 200, label: "Plant address" },
  hours: { kind: "text", max: 120, label: "Hours" },
  specsEmail: { kind: "email", label: "Spec requests go to" },
  landingChatEnabled: { kind: "bool", label: "Chat widget on the page" },
} as const satisfies Record<string, FieldSpec>;

export type ShopPageTextKey = {
  [K in keyof typeof SHOP_PAGE_FIELDS]: (typeof SHOP_PAGE_FIELDS)[K]["kind"] extends "bool" ? never : K;
}[keyof typeof SHOP_PAGE_FIELDS];
export type ShopPageBoolKey = Exclude<keyof typeof SHOP_PAGE_FIELDS, ShopPageTextKey>;


export type ShopStat = { label: string; value: string };

export type ShopPageValues = { [K in ShopPageTextKey]: string } & { [K in ShopPageBoolKey]: boolean } & {
  quoteTypes: QuoteTypeKey[]; // Step 47
  stats: ShopStat[];
};

export const STAT_MAX = 40;

/** The editable values from a shop's theme_json (missing = blank / off). */
export function shopPageValues(theme: unknown): ShopPageValues {
  const th = theme && typeof theme === "object" && !Array.isArray(theme) ? (theme as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(SHOP_PAGE_FIELDS)) {
    out[k] = spec.kind === "bool" ? th[k] === true : typeof th[k] === "string" ? (th[k] as string) : "";
  }
  out.quoteTypes = quoteTypesFromTheme(th); // Step 47 (missing = every type)
  out.stats = Array.isArray(th.stats)
    ? (th.stats as unknown[])
        .map((s) => {
          const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
          return { label: typeof o.label === "string" ? o.label : "", value: typeof o.value === "string" ? o.value : "" };
        })
        .filter((s) => s.label || s.value)
        .slice(0, 4)
    : [];
  return out as ShopPageValues;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function okUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export type CleanResult =
  | { ok: true; patch: Record<string, unknown>; ignored: string[] }
  | { ok: false; errors: Record<string, string> };

/**
 * Checks a set of changes from the Shop page form. Only the fields sent are
 * returned (the route merges them into the shop's saved theme). Fields a shop
 * may not edit (brandName, quoteTypes, …) are ignored and listed. Nothing is
 * trimmed to fit: a value that's too long or not valid is an error.
 */
export function cleanShopPagePatch(raw: unknown): CleanResult {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const ignored: string[] = [];

  for (const [k, v] of Object.entries(src)) {
    if (k === "quoteTypes") {
      // Step 47: at least one, from the three types, saved in the standard order
      if (!Array.isArray(v) || v.some((t) => typeof t !== "string" || !(QUOTE_TYPE_KEYS as string[]).includes(t))) {
        errors.quoteTypes = "Pick from the quote types listed.";
      } else if (v.length === 0) {
        errors.quoteTypes = "Pick at least one thing buyers can quote online.";
      } else {
        patch.quoteTypes = QUOTE_TYPE_KEYS.filter((t) => (v as string[]).includes(t));
      }
      continue;
    }
    if (k === "stats") {
      if (!Array.isArray(v) || v.length > 4) {
        errors.stats = "Up to 4 stats.";
        continue;
      }
      const rows: ShopStat[] = [];
      for (const s of v) {
        const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
        const label = typeof o.label === "string" ? o.label.trim() : "";
        const value = typeof o.value === "string" ? o.value.trim() : "";
        if (label.length > STAT_MAX || value.length > STAT_MAX) {
          errors.stats = `Each stat's number and label can be up to ${STAT_MAX} characters.`;
          break;
        }
        if (!label && !value) continue;
        if (!label || !value) {
          errors.stats = "Each stat needs both a number and a label (or leave both blank).";
          break;
        }
        rows.push({ label, value });
      }
      if (!errors.stats) patch.stats = rows;
      continue;
    }
    const spec = (SHOP_PAGE_FIELDS as Record<string, FieldSpec>)[k];
    if (!spec) {
      ignored.push(k);
      continue;
    }
    if (spec.kind === "bool") {
      if (typeof v !== "boolean") errors[k] = `${spec.label}: on or off.`;
      else patch[k] = v;
      continue;
    }
    if (typeof v !== "string") {
      errors[k] = `${spec.label}: text expected.`;
      continue;
    }
    const s = v.trim();
    if (spec.kind === "text") {
      if (s.length > spec.max) errors[k] = `${spec.label} can be up to ${spec.max} characters (now ${s.length}).`;
      else patch[k] = s;
    } else if (spec.kind === "url") {
      if (s && (s.length > 1000 || !okUrl(s))) errors[k] = `${spec.label}: a web address starting with https://`;
      else patch[k] = s;
    } else if (spec.kind === "email") {
      if (s && (s.length > 200 || !EMAIL.test(s))) errors[k] = `${spec.label}: an email address like quotes@yourshop.com`;
      else patch[k] = s;
    } else if (spec.kind === "hex") {
      if (s && !HEX.test(s)) errors[k] = `${spec.label}: a color code like #1060A0`;
      else patch[k] = s;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, patch, ignored };
}

/** The shop's Quotes & ordering page address. */
export function shopPageUrl(slug: string): string {
  return slug === "default" ? "https://api.alex-io.com/t/default" : `https://${slug}.api.alex-io.com/`;
}

export const REQUIRED_PAIR_NOTE = "Fill both boxes of a stat, or leave both blank.";

function normStats(stats: ShopStat[]): ShopStat[] {
  return stats
    .map((s) => ({ label: String(s.label || "").trim(), value: String(s.value || "").trim() }))
    .filter((s) => s.label || s.value);
}

/** The fields changed in the form since it loaded, ready to send as { changes }. */
export function shopPageChanges(form: ShopPageValues, loaded: ShopPageValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(SHOP_PAGE_FIELDS)) {
    const a = (form as Record<string, unknown>)[k];
    const b = (loaded as Record<string, unknown>)[k];
    if (spec.kind === "bool") {
      if (!!a !== !!b) out[k] = !!a;
    } else if (String(a ?? "").trim() !== String(b ?? "").trim()) {
      out[k] = String(a ?? "");
    }
  }
  const ft = QUOTE_TYPE_KEYS.filter((t) => form.quoteTypes.includes(t));
  if (JSON.stringify(ft) !== JSON.stringify(QUOTE_TYPE_KEYS.filter((t) => loaded.quoteTypes.includes(t)))) out.quoteTypes = ft;
  const fs = normStats(form.stats);
  if (JSON.stringify(fs) !== JSON.stringify(normStats(loaded.stats))) out.stats = fs;
  return out;
}

/** Step 47: is each kind of pricing set up? (from app/lib/onboarding.ts pricingReady) */
export type PricingReady = { materials: boolean; foam_rates: boolean; corrugated: boolean };

export type PricingWarning = { text: string; href: string; link: string };

/**
 * Step 47: what still needs prices for the quote types picked. A type can be
 * turned on before it's priced (quotes then use the catalog / default rates
 * and are flagged for review); these notes say what to set up.
 */
export function pricingWarnings(types: QuoteTypeKey[], ready: PricingReady): PricingWarning[] {
  const foam = types.includes("foam_insert") || types.includes("complete_pack");
  const boxes = types.includes("boxes_only") || types.includes("complete_pack");
  const out: PricingWarning[] = [];
  if (foam && !ready.materials) {
    out.push({ text: "Foam quotes use the catalog material prices until you set your own.", href: "/admin/materials", link: "Pricing → Foam materials" });
  }
  if (foam && !ready.foam_rates) {
    out.push({ text: "No foam cutting rates yet, so cutting isn't priced from your costs.", href: "/admin/settings/foam", link: "Pricing → Foam cutting rates" });
  }
  if (boxes && !ready.corrugated) {
    out.push({ text: "No board prices or converting rate yet, so boxes can't be priced from your costs.", href: "/admin/corrugated", link: "Pricing → Corrugated boxes" });
  }
  return out;
}
