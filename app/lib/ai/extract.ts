// app/lib/ai/extract.ts
// Robust text extractor for foam quote emails.

export type ExtractedSpec = {
  // dims in inches
  dims?: { L_in: number; W_in: number; H_in: number } | null;
  qty?: number | null;
  density_pcf?: number | null;
  foam_family?: "PE" | "EPE" | "PU" | "EVA" | string | null;
  color?: string | null;
  thickness_under_in?: number | null;
  unitsMentioned: boolean;

  // downstream hints
  dbFilter: {
    // prefer ranges over exacts to avoid over-filtering
    densityMin?: number;
    densityMax?: number;
    family?: string;
    color?: string;
  };
  searchWords: string[];
};

const n = (v: string) => parseFloat(v.replace(/[,\s]/g, ""));

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function norm(s?: string | null) {
  return (s || "").trim().toLowerCase();
}

const COLOR_WORDS = [
  "black","blue","white","gray","grey","red","green","yellow","tan","natural","pink","charcoal","beige","brown","orange","purple"
];

const FAMILY_ALIASES: Record<string,string> = {
  "polyethylene":"PE","pe":"PE","epe":"EPE","expanded polyethylene":"EPE",
  "eva":"EVA","pu":"PU","polyurethane":"PU","foam":"", // 'foam' alone is too generic
};

export function extractSpecs(text: string): ExtractedSpec {
  const raw = text || "";
  const t = raw.replace(/\u00A0/g, " "); // nbsp
  const tl = t.toLowerCase();

  // Qty
  let qty: number | null = null;
  const qtyMatch =
    tl.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) ||
    tl.match(/\b(\d{1,6})\s*(pcs|pieces|units|ea)\b/) ||
    tl.match(/\b(?:for|need|make)\s+(\d{1,6})\b/);
  if (qtyMatch) qty = clamp(parseInt(qtyMatch[1], 10), 1, 1_000_000);

  // Dims: 12 x 9 x 2   OR   L=12, W=9, H=2
  let dims: ExtractedSpec["dims"] = null;
  const xMatch = tl.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
  const lwhMatch =
    tl.match(/\bl\s*=?\s*(\d+(?:\.\d+)?)\b.*?\bw\s*=?\s*(\d+(?:\.\d+)?)\b.*?\bh\s*=?\s*(\d+(?:\.\d+)?)/);
  if (xMatch) {
    dims = { L_in: n(xMatch[1]), W_in: n(xMatch[2]), H_in: n(xMatch[3]) };
  } else if (lwhMatch) {
    dims = { L_in: n(lwhMatch[1]), W_in: n(lwhMatch[2]), H_in: n(lwhMatch[3]) };
  }

  // Units mentioned?
  const unitsMentioned = /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(t);

  // Density: 1.7 pcf / 1.7 lb/ft3 / 1.7 lb ft^3
  let density_pcf: number | null = null;
  const dMatch =
    tl.match(/\b(\d(?:\.\d+)?)\s*(pcf|lb\s*\/?\s*ft3|lb\/cu\s*ft|lb\/ft\^?3)\b/) ||
    tl.match(/\bdensity\s*[:=]?\s*(\d(?:\.\d+)?)\b/);
  if (dMatch) density_pcf = clamp(parseFloat(dMatch[1]), 0.5, 12);

  // Foam family (PE, EPE, PU, EVA) and color
  let family: string | null = null;
  for (const [k, v] of Object.entries(FAMILY_ALIASES)) {
    if (tl.includes(k)) { family = v; break; }
  }
  let color: string | null = null;
  for (const c of COLOR_WORDS) { if (tl.includes(c)) { color = c; break; } }

  // Thickness under
  let thickness_under_in: number | null = null;
  const thMatch = tl.match(/\b(thickness|under|bottom)\b.*?\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/);
  if (thMatch) {
    const v = parseFloat(thMatch[2]);
    const unit = thMatch[3];
    thickness_under_in = /mm/.test(unit) ? v/25.4 : v;
  }

  // Build DB filter (loose)
  const dbFilter: ExtractedSpec["dbFilter"] = {};
  if (density_pcf != null) {
    const span = 0.3; // ±0.3 pcf window
    dbFilter.densityMin = Math.max(0, density_pcf - span);
    dbFilter.densityMax = density_pcf + span;
  }
  if (family) dbFilter.family = family;
  if (color) dbFilter.color = color;

  // Search words (for ILIKE across name/vendor/notes)
  const searchWords = Array.from(
    new Set(
      [
        family || "",
        color || "",
        density_pcf != null ? String(density_pcf) : "",
        "foam",
        ...(dims ? [`${dims.L_in}x${dims.W_in}x${dims.H_in}`] : [])
      ]
        .map(w => w.trim())
        .filter(Boolean)
    )
  );

  return {
    dims, qty, density_pcf, foam_family: (family as any) || null, color,
    thickness_under_in,
    unitsMentioned,
    dbFilter,
    searchWords,
  };
}
