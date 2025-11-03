// app/lib/nlp.ts
// Lightweight spec extraction from free text.
// Looks for: dimensions (LxWxH inches), qty, foam type, density.

export type Dims = { l: number; w: number; h: number };
export type Parsed = {
  dims?: Dims | null;
  qty?: number | null;
  material?: "PE" | "EPE" | "PU" | null;
  density?: number | null; // lb/ft^3
  productType?: "insert" | "full" | null;
  notes?: string[];
};

const DIM_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches))?\b/i;

const QTY_RE = /\bqty\.?\s*(\d+)\b|\bquantity\s*(\d+)\b|\b(\d+)\s*pcs?\b/i;

const DENSITY_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:lb|lbs)\s*\/\s*(?:ft3|ft\^3|ft³)\b|\b(?:density)\s*(\d+(?:\.\d+)?)\b/i;

const MATERIAL_RE = /\b(?:pe|epe|pu|polyethylene|polyurethane)\b/i;

const PRODUCT_RE = /\binsert\b|\bfull(?:\s*pack)?\b/i;

function materialFrom(s: string): Parsed["material"] {
  const m = s.toLowerCase();
  if (m.includes("epe")) return "EPE";
  if (m.includes("pe")) return "PE";
  if (m.includes("polyethylene")) return "PE";
  if (m.includes("pu") || m.includes("polyurethane")) return "PU";
  return null;
}

export function parseSpecs(text: string): Parsed {
  const out: Parsed = {};
  const notes: string[] = [];

  // dims
  const d = text.match(DIM_RE);
  if (d) {
    out.dims = { l: +d[1], w: +d[2], h: +d[3] };
  }

  // qty
  const q = text.match(QTY_RE);
  if (q) {
    out.qty = +(q[1] || q[2] || q[3]);
  }

  // density
  const den = text.match(DENSITY_RE);
  if (den) {
    out.density = +(den[1] || den[2]);
  }

  // material
  const matHit = text.match(MATERIAL_RE);
  if (matHit) {
    out.material = materialFrom(matHit[0]) || null;
  }

  // product type
  const prod = text.match(PRODUCT_RE);
  if (prod) {
    out.productType = /insert/i.test(prod[0]) ? "insert" : "full";
  }

  // fallback hints
  if (!out.density && /1\.7/.test(text)) out.density = 1.7;
  if (!out.material && /epe/i.test(text)) out.material = "EPE";

  if (/rush|urgent|2[-\s]?day|expedite/i.test(text))
    notes.push("Requested fast turn.");

  out.notes = notes;
  return out;
}
