// app/lib/parse/matchers.ts
// Central, configurable keyword + regex parser for inbound quote emails.

export type SlotMap = {
  internal_length_in?: number;
  internal_width_in?: number;
  internal_height_in?: number;
  qty?: number;
  density_lbft3?: number;
  thickness_under_in?: number;
  cavities?: number;
};

export type SlotSources = Partial<Record<keyof SlotMap, string>>;

type KeywordPack = Record<
  string,
  {
    words: string[];
    patterns?: RegExp[]; // extra extractors beyond synonyms
  }
>;

// ----- Synonyms you can expand any time
export const PACKS: KeywordPack = {
  quantity: {
    words: ["quantity", "qty", "q", "pcs", "pieces", "units", "need", "order", "req", "required"],
    patterns: [
      // qty 25, quantity: 25, q=25, pcs 25, 25 pcs, 25 pieces, 25 units
      /\b(?:quantity|qty|q|pcs|pieces?|units?|req|required|order|need)s?\b\s*[:=]?\s*,?\s*(\d{1,6})\b/i,
      /\b(\d{1,6})\s*(?:pcs|pieces?|units?|ea|each)\b/i,
    ],
  },
  dimensions: {
    words: ["dimensions", "dimension", "dims", "size", "outside", "overall", "o/d", "od"],
    patterns: [
      // 12x9x3 or 12 × 9 × 3
      /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b/i,
      // L=12 W=9 H=3 or L:12 W:9 H:3 (any order)
      /\bL\s*[:=]?\s*(\d+(?:\.\d+)?)[^\S\r\n]+W\s*[:=]?\s*(\d+(?:\.\d+)?)[^\S\r\n]+H\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i,
    ],
  },
  density: {
    words: ["density", "lb/ft3", "lbft3", "lb ft3", "foam"],
    patterns: [
      // 1.7 lb/ft3, 2.2lbft3, PE 1.9, PU 1.2
      /\b(\d(?:\.\d+)?)\s*(?:lb\/?ft3|lbft3|lb\s*\/\s*ft3)\b/i,
      /\b(?:PE|EPE|EVA|PU)\b[^\d]{0,6}(\d(?:\.\d+)?)/i,
    ],
  },
  thickness_under: {
    words: ["under", "bottom", "pad", "underpad", "bottom pad", "pad under"],
    patterns: [
      // 0.5 under pad, under 0.75", bottom .25 in
      /\b(?:under|bottom|pad)\b[^\d]{0,6}(\d(?:\.\d+)?)\s*(?:in|inch|inches|")\b/i,
      /\b(\d(?:\.\d+)?)\s*(?:in|inch|inches|")\b[^\r\n]{0,10}\b(?:under|bottom|pad)\b/i,
    ],
  },
  cavities: {
    words: ["cavity", "cavities", "pocket", "pockets", "holes", "slots"],
    patterns: [
      /\b(?:cavities|cavity|pockets?|holes?|slots?)\b[^\d]{0,6}(\d{1,4})\b/i,
      /\b(\d{1,4})\b[^\w]{0,3}(?:cavities|cavity|pockets?|holes?|slots?)\b/i,
    ],
  },
};

// Utilities
const num = (s: string | undefined) => (s ? Number(s) : undefined);
const isFiniteNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Extract structured slots + the matched substrings that produced them. */
export function extractSlots(text: string): { slots: SlotMap; sources: SlotSources } {
  const raw = text ?? "";
  const slots: SlotMap = {};
  const sources: SlotSources = {};

  // Dimensions
  for (const rx of PACKS.dimensions.patterns ?? []) {
    const m = rx.exec(raw);
    if (m) {
      slots.internal_length_in = num(m[1]);
      slots.internal_width_in  = num(m[2]);
      slots.internal_height_in = num(m[3]);
      sources.internal_length_in = m[0];
      sources.internal_width_in  = m[0];
      sources.internal_height_in = m[0];
      break;
    }
  }

  // Quantity (first matching variant wins)
  for (const rx of PACKS.quantity.patterns ?? []) {
    const m = rx.exec(raw);
    if (m) {
      slots.qty = num(m[1]);
      sources.qty = m[0];
      break;
    }
  }

  // Density
  for (const rx of PACKS.density.patterns ?? []) {
    const m = rx.exec(raw);
    if (m) {
      slots.density_lbft3 = num(m[1]);
      sources.density_lbft3 = m[0];
      break;
    }
  }

  // Under-pad thickness
  for (const rx of PACKS.thickness_under.patterns ?? []) {
    const m = rx.exec(raw);
    if (m) {
      slots.thickness_under_in = num(m[1]);
      sources.thickness_under_in = m[0];
      break;
    }
  }

  // Cavities
  for (const rx of PACKS.cavities.patterns ?? []) {
    const m = rx.exec(raw);
    if (m) {
      slots.cavities = num(m[1]);
      sources.cavities = m[0];
      break;
    }
  }

  // final normalization
  if (!isFiniteNum(slots.cavities)) slots.cavities = undefined;
  if (!isFiniteNum(slots.qty) || (slots.qty as number) <= 0) slots.qty = undefined;

  return { slots, sources };
}
