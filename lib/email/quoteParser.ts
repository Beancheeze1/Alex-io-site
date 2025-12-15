// lib/email/quoteParser.ts
// Lightweight email → quote intent parser for foam jobs.
// Extracts: outer dims, quantity, material hints, and multiple cavities.
//
// PATH-A HARDENING (12/15):
// - Recognize "sets" and common phrasing as qty (e.g. "quote 25 sets").
// - If explicit outer LxWxH is missing but layer intent exists (footprint + thicknesses),
//   infer outer dims = footprintL x footprintW x sum(thicknesses).
// - Keep cavity parsing behavior unchanged.

export type ParsedCavity = {
  label: "slot" | "square" | "rect" | "circle" | "round";
  w?: number; // inches
  l?: number; // inches
  d?: number; // depth inches
  dia?: number; // for circle/round
  count: number;
};

export type ParsedEmailQuote = {
  qty?: number;
  length_in?: number;
  width_in?: number;
  height_in?: number;
  material_hint?: string; // e.g., "PE", "EPE", "PU"
  density_hint?: number | null; // e.g., 2 for 2#
  cavities: ParsedCavity[];
  notes?: string[];
};

// ---- regex pieces as PLAIN strings (no template literals) ----
const INCH = "(?:(?:\\d+(?:\\.\\d+)?)|(?:\\d+\\s*/\\s*\\d+))";
const SEP = "(?:\\s*[x×]\\s*)";
const INCH_SYM = "(?:\\s*(?:\\\"|in\\.?|inch(?:es)?))?"; // allow ", in, inch

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

/**
 * Layer-intent inference:
 * - "(3) 12x12 layers" / "3 12 x 12 layers"
 * - "top layer ... 1\" thick" / "middle layer ... 4 inches thick" / "bottom layer ... 1 in thick"
 */
function inferDimsFromLayers(src: string): { L?: number; W?: number; H?: number } {
  const s = (src || "").toLowerCase().replace(/[”“]/g, '"');

  // footprint: (3) 12"x12" layers  OR  3 12 x 12 layers
  const reFoot = new RegExp(
    "\\b\\(?\\s*(\\d{1,2})\\s*\\)?\\s*(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      "\\s*(?:layers?|pcs?\\s+of\\s+layers?)\\b",
    "i",
  );
  const mFoot = s.match(reFoot);
  const fpL = toInches(mFoot?.[2]);
  const fpW = toInches(mFoot?.[3]);

  // thicknesses: top/middle/bottom layer ... 1" thick
  const reTh = new RegExp(
    "\\b(top|middle|bottom)\\s+layer\\b[^.\\n\\r]{0,140}?\\b(" +
      INCH +
      ")" +
      INCH_SYM +
      "\\b[^.\\n\\r]{0,60}?\\bthick\\b",
    "gi",
  );

  let top: number | undefined;
  let mid: number | undefined;
  let bot: number | undefined;

  let m: RegExpExecArray | null;
  while ((m = reTh.exec(s))) {
    const pos = String(m[1] || "").toLowerCase();
    const th = toInches(m[2]);
    if (!th || !isFinite(th) || th <= 0) continue;
    if (pos === "top") top = th;
    if (pos === "middle") mid = th;
    if (pos === "bottom") bot = th;
  }

  const thicknesses = [top, mid, bot].filter((n) => typeof n === "number" && isFinite(n as number) && (n as number) > 0) as number[];
  const sumH = thicknesses.reduce((a, b) => a + b, 0);

  if (fpL && fpW && sumH > 0) {
    return { L: fpL, W: fpW, H: sumH };
  }

  return {};
}

export function parseEmailQuote(text: string): ParsedEmailQuote {
  const src = (text || "").replace(/[”“]/g, '"').toLowerCase();
  const out: ParsedEmailQuote = { cavities: [], notes: [] };

  // qty (support: qty: 25, quantity 25, quote 25, for 25, 25 sets)
  const mQty =
    src.match(/\bqty[:\s]*([0-9]{1,6})\b/i) ||
    src.match(/\bquantity[:\s]*([0-9]{1,6})\b/i) ||
    src.match(/\bquote\s+([0-9]{1,6})\b/i) ||
    src.match(/\bfor\s+([0-9]{1,6})\b/i) ||
    src.match(/\b([0-9]{1,6})\s*(?:pcs?|pieces?|parts?|sets?)\b/i);

  if (mQty) out.qty = Number(mQty[1]);

  // material / density hints
  const mPE = src.match(/\b(pe|epe|polyethylene|pp|pu|urethane|zote)\b/);
  if (mPE) out.material_hint = mPE[1];
  const mDen = src.match(/\b([1-9](?:\.[05])?)\s*#\b/);
  out.density_hint = mDen ? Number(mDen[1]) : null;

  // OUTER block dims (20 x 16 x 2 ; 20" x 16" x 2")
  const reLWH = new RegExp(
    "\\b(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM,
    "i",
  );
  const mBox = src.match(reLWH);
  if (mBox) {
    out.length_in = toInches(mBox[1]);
    out.width_in = toInches(mBox[2]);
    out.height_in = toInches(mBox[3]);
  } else {
    const l = src.match(new RegExp("(?:length|long|l)[:\\s]*(" + INCH + ")"));
    const w = src.match(new RegExp("(?:width|wide|w)[:\\s]*(" + INCH + ")"));
    const h = src.match(new RegExp("(?:height|thick|t|h)[:\\s]*(" + INCH + ")"));
    out.length_in = toInches(l?.[1]);
    out.width_in = toInches(w?.[1]);
    out.height_in = toInches(h?.[1]);
  }

  // If explicit LxWxH is missing, try infer from layer intent (footprint + sum thickness).
  if (!out.length_in || !out.width_in || !out.height_in) {
    const inferred = inferDimsFromLayers(src);
    if (inferred.L && inferred.W && inferred.H) {
      out.length_in = out.length_in ?? inferred.L;
      out.width_in = out.width_in ?? inferred.W;
      out.height_in = out.height_in ?? inferred.H;
    }
  }

  // CAVITIES — several phrase styles
  const cavities: ParsedCavity[] = [];

  // Squares/rectangles like “two 2 x 2 x 1 deep square pockets”
  const reRect = new RegExp(
    "(?:(\\d{1,3})\\s*)?(?:cav(?:ity|ities)?|slots?|rects?|rectangles?|pockets?)?\\D*" +
      "\\b(?:square|rect(?:angle)?)\\b\\D*" +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      "(?:" +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      ")?" +
      "(?:\\D{0,15}\\b(?:deep|depth)\\b)?",
    "g",
  );

  // Generic L x W x D “slots/pockets/cavities”
  const reSlot = new RegExp(
    "(?:(\\d{1,3})\\s*)?(?:slots?|pockets?|cav(?:ity|ities)?)\\D+" +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM,
    "g",
  );

  // Circles/Rounds like “two 3\" round x 1\" deep” / “1 circle dia 3 x 1”
  const reRound = new RegExp(
    "(?:(\\d{1,3})\\s*)?(?:holes?|circles?|rounds?)\\D+" +
      "(?:dia(?:meter)?\\D*)?(" +
      INCH +
      ")" +
      INCH_SYM +
      "(?:\\D+(" +
      INCH +
      ")" +
      INCH_SYM +
      ")?",
    "g",
  );

  // Loose “N 2 x 2 x 1 deep”
  const reLooseRect = new RegExp(
    "\\b(\\d{1,3})\\b\\D+(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      SEP +
      "(" +
      INCH +
      ")" +
      INCH_SYM +
      "\\D*(?:deep|depth)?",
    "g",
  );

  src.replace(reRect, (_all: string, c: string, w: string, l: string, d: string) => {
    cavities.push({ label: "square", w: toInches(w), l: toInches(l), d: toInches(d), count: Number(c || 1) });
    return "";
  });
  src.replace(reSlot, (_all: string, c: string, w: string, l: string, d: string) => {
    cavities.push({ label: "slot", w: toInches(w), l: toInches(l), d: toInches(d), count: Number(c || 1) });
    return "";
  });
  src.replace(reRound, (_a: string, c: string, dia: string, d: string) => {
    cavities.push({ label: "circle", dia: toInches(dia), d: toInches(d), count: Number(c || 1) });
    return "";
  });
  src.replace(reLooseRect, (_a: string, c: string, w: string, l: string, d: string) => {
    cavities.push({ label: "rect", w: toInches(w), l: toInches(l), d: toInches(d), count: Number(c || 1) });
    return "";
  });

  out.cavities = cavities
    .filter((c) => (c.dia || (c.w && c.l)) && (c.d || c.d === 0))
    .map((c) => ({ ...c, label: c.label === "square" && c.w && c.l && c.w !== c.l ? "rect" : c.label }));

  if (!out.length_in || !out.width_in || !out.height_in) out.notes?.push("Missing or incomplete outer dimensions.");
  if (!out.cavities.length) out.notes?.push("No cavities detected (ok if solid block).");

  return out;
}
