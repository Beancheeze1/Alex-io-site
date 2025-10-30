// lib/email/quoteParser.ts
// Lightweight email → quote intent parser for foam jobs.
// Extracts: outer dims, quantity, material hints, and multiple cavities.

export type ParsedCavity = {
  label: "slot" | "square" | "rect" | "circle" | "round";
  w?: number;  // inches
  l?: number;  // inches
  d?: number;  // depth inches
  dia?: number;
  count: number;
};

export type ParsedEmailQuote = {
  qty?: number;
  length_in?: number;
  width_in?: number;
  height_in?: number;
  material_hint?: string;   // e.g., "PE", "EPE", "2#"
  density_hint?: number | null; // e.g., 2 for 2#
  cavities: ParsedCavity[];
  notes?: string[];
};

const INCH = `(?:(?:\\d+(?:\\.\\d+)?)|(?:\\d+\\s*/\\s*\\d+))`;
const SEP = `(?:\\s*[x×]\\s*)`;
const INCH_SYM = `(?:\\s*(?:\"|in\\.?|inch(?:es)?))?`;

// normalize fractions like 1/2 -> 0.5
function toInches(raw?: string): number | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (/^\d+\s*\/\s*\d+$/.test(t)) {
    const [a, b] = t.split("/").map(Number);
    return b ? a / b : undefined;
  }
  const n = Number(t);
  return isFinite(n) ? n : undefined;
}

export function parseEmailQuote(text: string): ParsedEmailQuote {
  const src = (text || "").replace(/\u201d|\u201c|”|“/g, '"').toLowerCase();
  const out: ParsedEmailQuote = { cavities: [], notes: [] };

  // qty
  const mQty = src.match(/\bqty[:\s]*([0-9]{1,5})\b/);
  if (mQty) out.qty = Number(mQty[1]);

  // material / density hints (very light heuristics)
  const mPE = src.match(/\b(pe|poly(?:ethylene)?|epe|pp|pu|urethane|zote)\b/);
  if (mPE) out.material_hint = mPE[1];
  const mDen = src.match(/\b([1-9](?:\.[05])?)\s*#\b/); // 1#, 1.5#, 2#, etc.
  out.density_hint = mDen ? Number(mDen[1]) : null;

  // OUTER block dims — patterns:
  // 1) "20 x 16 x 2"  2) "20\" x 16\" x 2\""  3) "length 20 width 16 height 2"
  const reLWH = new RegExp(`\\b(${INCH})${INCH_SYM}${SEP}(${INCH})${INCH_SYM}${SEP}(${INCH})${INCH_SYM}`, "i");
  const mBox = src.match(reLWH);
  if (mBox) {
    out.length_in = toInches(mBox[1]);
    out.width_in  = toInches(mBox[2]);
    out.height_in = toInches(mBox[3]);
  } else {
    const l = src.match(/(?:length|long|l)[:\s]*(${INCH})/);
    const w = src.match(/(?:width|wide|w)[:\s]*(${INCH})/);
    const h = src.match(/(?:height|thick|t|h)[:\s]*(${INCH})/);
    out.length_in = toInches(l?.[1]);
    out.width_in  = toInches(w?.[1]);
    out.height_in = toInches(h?.[1]);
  }

  // CAVITIES — handle several phrases:
  // a) "two 2\" square x 1\" deep" / "2 cavities 2 x 2 x 1 deep"
  // b) "3 slots 1\" x 6\" x 2\""
  // c) "1 circle dia 3\" x 1\" deep" / "two 3\" round x 1\""
  // d) "2 rectangles 2 x 4 x 1"
  // We capture multiple matches.

  const cavities: ParsedCavity[] = [];

  // square/rect with depth
  const reRect = new RegExp(
    `(?:(\\d{1,3})\\s*(?:x|×)?\\s*(?:cav(?:ity|ities)?|slots?|rects?|rectangles?|pockets?)[,\\s]*)?` + // optional count leading
    `(?:(\\d{1,3}))?\\s*(?:x|×)?\\s*(?:cav(?:ity|ities)?|)?` +
    `\\b(?:square|rect(?:angle)?)\\b[^\\d]*` +
    `(${INCH})${INCH_SYM}${SEP}(${INCH})${INCH_SYM}(?:${SEP}(${INCH})${INCH_SYM})?` +
    `(?:[^\\d]{0,15}\\b(?:deep|depth)\\b)?`,
    "g"
  );

  // generic L x W x D pockets/slots
  const reSlot = new RegExp(
    `(?:(\\d{1,3})\\s*)?(?:slots?|pockets?|cav(?:ity|ities)?)\\D+` +
    `(${INCH})${INCH_SYM}${SEP}(${INCH})${INCH_SYM}${SEP}(${INCH})${INCH_SYM}`,
    "g"
  );

  // round
  const reRound = new RegExp(
    `(?:(\\d{1,3})\\s*)?(?:holes?|circles?|rounds?)\\D+` +
    `(?:dia(?:meter)?\\D*)?(${INCH})${INCH_SYM}(?:\\D+(${INCH})${INCH_SYM})?`,
    "g"
  );

  // loose “N 2 x 2 x 1 deep” (no word labels)
  const reLooseRect = new RegExp(
    `\\b(\\d{1,3})\\b\\D*(${INCH})${INCH_SYM}${SEP}(${INCH})${INCH_SYM}${SEP}(${INCH})${INCH_SYM}\\D*(?:deep|depth)?`,
    "g"
  );

  // Run all patterns
  src.replace(reRect, (_all, c1, _cavword, w, l, d) => {
    const count = Number(c1 || 1);
    cavities.push({ label: "square", w: toInches(w), l: toInches(l), d: toInches(d), count });
    return "";
  });

  src.replace(reSlot, (_all, c, w, l, d) => {
    const count = Number(c || 1);
    cavities.push({ label: "slot", w: toInches(w), l: toInches(l), d: toInches(d), count });
    return "";
  });

  src.replace(reRound, (_a, c, dia, d) => {
    const count = Number(c || 1);
    cavities.push({ label: "circle", dia: toInches(dia), d: toInches(d), count });
    return "";
  });

  src.replace(reLooseRect, (_a, c, w, l, d) => {
    const count = Number(c || 1);
    cavities.push({ label: "rect", w: toInches(w), l: toInches(l), d: toInches(d), count });
    return "";
  });

  out.cavities = cavities.filter(c => (c.dia || (c.w && c.l)) && (c.d || c.d === 0)).map(c => ({
    ...c,
    // Normalize: if only square mentioned and w != l, switch to rect
    label: c.label === "square" && c.w && c.l && c.w !== c.l ? "rect" : c.label
  }));

  // Notes: keep what we didn’t fully understand
  if (!out.length_in || !out.width_in || !out.height_in) out.notes?.push("Missing or incomplete outer dimensions.");
  if (!out.cavities.length) out.notes?.push("No cavities detected (ok if solid block).");

  return out;
}
