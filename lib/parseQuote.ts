// lib/parseQuote.ts
// Path-A: no external deps. Handles: 24x18x2, 24 x 18 x 2 in, 2" square x 1" deep,
// fractions like 1-1/2", "1 1/2", and material hints like "2# PE", "2 lb PE".

export type ParsedCavity = {
  label: string;             // "slot" | "square" | "rect" | "round" (best-effort)
  count: number;
  cav_length_in: number;     // for round, use diameter in cav_length_in and cav_width_in
  cav_width_in: number;
  cav_depth_in: number;
};

export type ParsedQuote = {
  length_in?: number;
  width_in?: number;
  height_in?: number;
  qty?: number;
  material_hint?: { density_lb_ft3?: number; name_like?: string }; // we'll resolve to material_id
  cavities: ParsedCavity[];
  notes?: string;
};

const INCH = /(?:"|in\b|inch(?:es)?\b)/i;
const NUM = `(?:\\d+(?:\\.\\d+)?|\\d+\\s+\\d\\/\\d|\\d+\\-\\d\\/\\d|\\d\\/\\d)`; // 1, 1.5, 1 1/2, 1-1/2, 1/2
const numRe = new RegExp(NUM);
function parseNum(s: string): number {
  s = s.trim();
  // 1-1/2
  const dashFrac = /^(\d+)-(\d+)\/(\d+)$/.exec(s);
  if (dashFrac) return Number(dashFrac[1]) + Number(dashFrac[2]) / Number(dashFrac[3]);
  // 1 1/2
  const spFrac = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (spFrac) return Number(spFrac[1]) + Number(spFrac[2]) / Number(spFrac[3]);
  // 1/2
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

function findDims(text: string) {
  // 24 x 18 x 2 (with optional symbols/units)
  const re = new RegExp(`\\b(${NUM})\\s*(?:x|by|\\*)\\s*(${NUM})\\s*(?:x|by|\\*)\\s*(${NUM})(?:\\s*${INCH.source})?`, "i");
  const m = re.exec(text);
  if (!m) return null;
  return {
    length_in: parseNum(m[1]),
    width_in:  parseNum(m[2]),
    height_in: parseNum(m[3]),
  };
}

function findQty(text: string) {
  // "qty 10", "quantity 25", "25 pieces"
  const m = /\b(?:qty|quantity)\s*(\d+)\b/i.exec(text) || /\b(\d+)\s*(?:pcs?|pieces?)\b/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

function findMaterial(text: string) {
  // "2# PE", "2 lb pe", "2lb polyethylene", "XLPE 2#"
  const m = /\b(\d+(?:\.\d+)?)\s*(?:#|lb|lbs?)\b.*?\b(pe|xlpe|epe|polyethylene)\b/i.exec(text);
  const alt = /\b(pe|xlpe|epe|polyethylene)\b.*?(\d+(?:\.\d+)?)\s*(?:#|lb|lbs?)\b/i.exec(text);
  const hit = m || (alt ? { 1: alt[2], 2: alt[1] } as any : null);
  if (!hit) return null;
  return {
    density_lb_ft3: Number(hit[1]),
    name_like: (hit[2] || "pe").toUpperCase()
  };
}

function toSquare(label = "square", count = 1, side = 1, depth = 1): ParsedCavity {
  return { label, count, cav_length_in: side, cav_width_in: side, cav_depth_in: depth };
}

function toRect(label = "slot", count = 1, l = 1, w = 1, d = 1): ParsedCavity {
  return { label, count, cav_length_in: l, cav_width_in: w, cav_depth_in: d };
}

function findCavities(text: string): ParsedCavity[] {
  const out: ParsedCavity[] = [];

  // e.g., "2 cavities both 2" square and 1" deep"
  {
    const re = new RegExp(
      `\\b(\\d+)\\s+(?:cavities|cavity|pockets?)\\b[\\s\\S]{0,40}?\\b(${NUM})\\s*(?:${INCH.source})?\\s*(?:square)\\b[\\s\\S]{0,25}?\\b(${NUM})\\s*(?:${INCH.source})?\\s*(?:deep|depth)`,
      "i"
    );
    const m = re.exec(text);
    if (m) out.push(toSquare("square", Number(m[1]), parseNum(m[2]), parseNum(m[3])));
  }

  // e.g., "3 slots 5 x 1.5 x 1", "one slot 6\" x 2\" x 1\""
  {
    const re = new RegExp(
      `\\b(\\d+|one|two|three|four|five)\\s+(?:slots?|rectangles?|cavities|pockets?)\\b[\\s\\S]{0,30}?(${NUM})\\s*(?:x|by)\\s*(${NUM})\\s*(?:x|by)\\s*(${NUM})(?:\\s*${INCH.source})?`,
      "i"
    );
    const m = re.exec(text);
    if (m) {
      const word = m[1].toLowerCase();
      const wordToNum: Record<string, number> = { one:1,two:2,three:3,four:4,five:5 };
      const count = /^\d+$/.test(word) ? Number(word) : (wordToNum[word] ?? 1);
      out.push(toRect("slot", count, parseNum(m[2]), parseNum(m[3]), parseNum(m[4])));
    }
  }

  // round/pucks: "4 holes 1.25\" dia x 0.5\" deep"
  {
    const re = new RegExp(
      `\\b(\\d+)\\s+(?:holes?|round|circles?)\\b[\\s\\S]{0,20}?(${NUM})\\s*(?:${INCH.source})?\\s*(?:dia|diameter)\\b[\\s\\S]{0,20}?(${NUM})\\s*(?:${INCH.source})?\\s*(?:deep|depth)`,
      "i"
    );
    const m = re.exec(text);
    if (m) {
      const dia = parseNum(m[2]), d = parseNum(m[3]), count = Number(m[1]);
      out.push({ label:"round", count, cav_length_in: dia, cav_width_in: dia, cav_depth_in: d });
    }
  }

  return out;
}

export function parseEmailToQuote(text: string): ParsedQuote {
  const t = text.replace(/\u201c|\u201d/g, '"'); // smart quotes → "
  const dims = findDims(t) || {};
  const qty = findQty(t);
  const material = findMaterial(t) || undefined;
  const cavities = findCavities(t);

  return {
    ...dims,
    qty,
    material_hint: material,
    cavities,
    notes: cavities.length ? undefined : "No cavities parsed (fallback to net block)."
  };
}
