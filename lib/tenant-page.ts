// lib/tenant-page.ts
//
// Server-side loader + sanitizers for the tenant "Quotes & ordering" page
// (app/t/[tenant]/page.tsx). All page content lives in tenants.theme_json.
// Everything here is defensive: theme_json is admin-entered free text, so
// colors are hex-only, links are http(s)-only, and every field is length-capped.

import { one } from "@/lib/db";

export const PRODUCT_KEYS = ["rsc", "printed", "mailer", "foam", "kit"] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

export const PRODUCT_INFO: Record<ProductKey, { label: string; desc: string }> = {
  rsc: { label: "Corrugated boxes", desc: "Regular slotted cartons in single and double wall." },
  printed: { label: "Printed packaging", desc: "Boxes printed with your logo and handling marks." },
  mailer: { label: "Die-cut mailers", desc: "Self-locking mailers for shipping and retail." },
  foam: { label: "Foam inserts", desc: "Foam cut to hold your part in place." },
  kit: { label: "Foam-in-box kits", desc: "Box and insert quoted together as one kit." },
};

export type TenantStat = { label: string; value: string };

export type TenantPage = {
  id: number;
  slug: string;
  brandName: string;
  initials: string;
  logoUrl: string;
  heroUseLogo: boolean;
  landingChatEnabled: boolean;
  primaryColor: string;
  onPrimary: string;
  /** Brand color safe to use for icons/links on light surfaces (>= 3:1 vs white). */
  accentOnLight: string;
  secondaryColor: string;
  onSecondary: string;
  tagline: string;
  websiteUrl: string;
  websiteLabel: string;
  phone: string;
  phoneHref: string;
  email: string;
  address: string;
  hours: string;
  heroImageUrl: string;
  heroCaption: string;
  quoteIntro: string;
  quoteScope: string;
  products: ProductKey[];
  aboutText: string;
  stats: TenantStat[];
};

const DEFAULT_PRIMARY = "#2B2B28"; // DESIGN_SYSTEM.md --action-primary
const DEFAULT_SECONDARY = "#1C1C1A"; // DESIGN_SYSTEM.md --text-primary
const DARK_TEXT = "#1C1C1A";
const LIGHT_TEXT = "#FFFFFF";

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function safeHex(v: unknown, fallback: string): string {
  const s = str(v, 9);
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fallback;
}

export function safeUrl(v: unknown): string {
  const s = str(v, 1000);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Picks white or near-black text, whichever contrasts more with the fill. */
export function readableTextOn(hex: string): string {
  const L = relLuminance(hex);
  const vsWhite = 1.05 / (L + 0.05);
  const vsDark = (L + 0.05) / (relLuminance(DARK_TEXT) + 0.05);
  return vsWhite >= vsDark ? LIGHT_TEXT : DARK_TEXT;
}

function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Brand color to use for icons and links on the page's light surfaces.
 * Uses the primary color when it has at least 3:1 contrast against white,
 * otherwise the secondary color, otherwise near-black.
 */
export function accentOnLightOf(primary: string, secondary: string): string {
  if (contrastRatio(primary, "#FFFFFF") >= 3) return primary;
  if (contrastRatio(secondary, "#FFFFFF") >= 3) return secondary;
  return DARK_TEXT;
}

export function phoneHrefOf(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : "";
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}

export async function loadTenantPage(slugRaw: string): Promise<TenantPage | null> {
  const slug = String(slugRaw || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,63}$/.test(slug)) return null;

  const row = await one<{ id: number; slug: string; name: string; theme_json: unknown }>(
    `
    select id, slug, name, theme_json
    from public.tenants
    where slug = $1
      and active = true
    limit 1
    `,
    [slug],
  );
  if (!row) return null;

  const th: Record<string, unknown> =
    row.theme_json && typeof row.theme_json === "object" && !Array.isArray(row.theme_json)
      ? (row.theme_json as Record<string, unknown>)
      : {};

  const brandName = str(th.brandName, 120) || str(row.name, 120) || row.slug;
  const primaryColor = safeHex(th.primaryColor, DEFAULT_PRIMARY);
  const secondaryColor = safeHex(th.secondaryColor, DEFAULT_SECONDARY);
  const websiteUrl = safeUrl(th.websiteUrl);
  const phone = str(th.phone, 40);

  const products: ProductKey[] = Array.isArray(th.products)
    ? Array.from(
        new Set(
          (th.products as unknown[]).filter(
            (k): k is ProductKey => typeof k === "string" && (PRODUCT_KEYS as readonly string[]).includes(k),
          ),
        ),
      )
    : [];

  const stats: TenantStat[] = Array.isArray(th.stats)
    ? (th.stats as unknown[])
        .map((s) => {
          const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
          return { label: str(o.label, 40), value: str(o.value, 40) };
        })
        .filter((s) => s.label && s.value)
        .slice(0, 4)
    : [];

  const quoteScope = str(th.quoteScope, 120) || "your packaging";

  return {
    id: row.id,
    slug: row.slug,
    brandName,
    initials: initialsOf(brandName),
    logoUrl: safeUrl(th.logoUrl),
    heroUseLogo: th.heroUseLogo === true,
    landingChatEnabled: th.landingChatEnabled === true,
    primaryColor,
    onPrimary: readableTextOn(primaryColor),
    accentOnLight: accentOnLightOf(primaryColor, secondaryColor),
    secondaryColor,
    onSecondary: readableTextOn(secondaryColor),
    tagline: str(th.tagline, 120),
    websiteUrl,
    websiteLabel: websiteUrl ? hostLabel(websiteUrl) : "",
    phone,
    phoneHref: phone ? phoneHrefOf(phone) : "",
    email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(str(th.email, 200)) ? str(th.email, 200) : "",
    address: str(th.address, 200),
    hours: str(th.hours, 120),
    heroImageUrl: safeUrl(th.heroImageUrl),
    heroCaption: str(th.heroCaption, 120),
    quoteIntro:
      str(th.quoteIntro, 300) ||
      `Price ${quoteScope} online any time, or talk to our team about anything custom.`,
    quoteScope,
    products,
    aboutText: str(th.aboutText, 1200),
    stats,
  };
}
