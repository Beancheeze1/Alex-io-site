// app/lib/ai/extract.ts
import { inchesFrom, toNumber, cleanToken } from "./normalize";

// small helpers
const rx = {
  dims1: /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i,
  dims2: /\bL\s*=?\s*(\d+(?:\.\d+)?)\b.*\bW\s*=?\s*(\d+(?:\.\d+)?)\b.*\bH\s*=?\s*(\d+(?:\.\d+)?)/i,
  qty: /\bqty\s*[:=]?\s*(\d+)\b/i,
  qtyAlt: /\b(\d{1,6})\s*(pcs|pieces|units|ea)\b/i,
  densityLbFt3: /\b(\d+(?:\.\d+)?)\s*(?:lb|pounds?)\s*\/?\s*ft3\b/i,
  densityPCF: /\b(\d+(?:\.\d+)?)\s*pcf\b/i,
  thicknessUnder: /\b(thickness|under|bottom)\b.*?\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i,
};

const familyWords = {
  pe: ["pe", "polyethylene", "epe", "xlpe", "crosslinked pe", "cross-linked pe"],
  pu: ["pu", "polyurethane", "foam rubber", "urethane"],
  eva: ["eva"],
};

const colorWords = {
  black: ["black", "blk"],
  white: ["white", "wht"],
  gray: ["gray", "grey", "gry"],
  blue: ["blue"],
  pink: ["pink", "anti static", "antistatic", "anti-static"],
};

function findFirstWord(text: string, dict: Record<string, string[]>) {
  const t = text.toLowerCase();
  for (const key of Object.keys(dict)) {
    for (const w of dict[key]) {
      if (t.includes(w)) return key;
    }
  }
  return null;
}

export type ExtractedSpec = {
  dims?: { L_in: number; W_in: number; H_in: number };
  qty?: number;
  density_pcf?: number;
  thickness_under_in?: number;
  unitsMentioned: boolean;
  foam_family?: "pe" | "pu" | "eva";
  color?: string | null;
  features: string[];       // e.g., "case insert", "tooling", "die cut", "waterjet", etc.
  searchWords: string[];    // dense keywords for DB / quick search
  dbFilter: {
    family?: string | null;
    densityMin?: number | null;
    densityMax?: number | null;
    color?: string | null;
  };
};

export function extractSpecs(rawText: string): ExtractedSpec {
  const text = rawText || "";
  const out: ExtractedSpec = {
    unitsMentioned: /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(text),
    features: [],
    searchWords: [],
    dbFilter: {},
  };

  // dims
  let m = text.match(rx.dims1);
  if (!m) m = text.match(rx.dims2);
  if (m) {
    const L = toNumber(m[1])!, W = toNumber(m[2])!, H = toNumber(m[3])!;
    out.dims = { L_in: L, W_in: W, H_in: H };
  }

  // qty
  const q = text.match(rx.qty) || text.match(rx.qtyAlt);
  if (q) out.qty = Number(q[1]);

  // density
  const d = text.match(rx.densityLbFt3) || text.match(rx.densityPCF);
  if (d) out.density_pcf = Number(d[1]);

  // thickness under
  const tu = text.match(rx.thicknessUnder);
  if (tu) {
    const n = Number(tu[2]);
    const unit = tu[3];
    out.thickness_under_in = inchesFrom(text, n, unit);
  }

  // foam family + color
  const family = findFirstWord(text, familyWords);
  if (family) {
    out.foam_family = family as any;
    out.dbFilter.family = family;
  }
  const color = findFirstWord(text, colorWords);
  if (color) {
    out.color = color;
    out.dbFilter.color = color;
  }

  // density range for DB (±0.2 pcf to tolerate vague emails)
  if (out.density_pcf !== undefined) {
    const d = out.density_pcf!;
    out.dbFilter.densityMin = Math.max(0, d - 0.2);
    out.dbFilter.densityMax = d + 0.2;
  }

  // features + searchWords
  const tokens = text
    .split(/\s+/g)
    .map(cleanToken)
    .filter(Boolean);

  // light heuristic tags
  const featureMap: Record<string, string> = {
    "case": "case insert",
    "pelican": "case insert",
    "shadow": "shadow board",
    "diecut": "die cut",
    "die-cut": "die cut",
    "waterjet": "waterjet",
    "cnc": "cnc",
    "adhesive": "adhesive",
    "laminate": "laminate",
    "antistatic": "anti static",
    "anti-static": "anti static",
    "static": "anti static",
    "xpe": "xlpe",
  };
  const features = new Set<string>();
  for (const t of tokens) {
    if (featureMap[t]) features.add(featureMap[t]);
  }
  out.features = Array.from(features);

  // search words to try in DB free-text columns (name/notes/vendor)
  const sw = new Set<string>();
  if (family) sw.add(family);
  if (color) sw.add(color);
  if (out.density_pcf) sw.add(`${out.density_pcf}pcf`);
  for (const f of out.features) sw.add(f);
  // keep a few useful raw tokens (shortlist)
  for (const t of tokens) {
    if (t.length >= 3 && /^[a-z0-9.+/-]+$/.test(t)) sw.add(t);
  }
  out.searchWords = Array.from(sw).slice(0, 20);

  return out;
}
