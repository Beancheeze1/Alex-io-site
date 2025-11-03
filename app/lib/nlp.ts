// /app/lib/nlp.ts
//
// Lightweight NLP helpers to detect intent and extract quote parameters
// from free-form email text (sizes, qty, material, density, notes).

export type Intent =
  | "estimate"
  | "greeting"
  | "followup"
  | "unknown";

export type Units = "in" | "inch" | "inches" | "\"";

export type Material =
  | "EPE"   // expanded polyethylene
  | "PE"
  | "PU"
  | "EVA"
  | "HONEYCOMB"
  | "UNKNOWN";

export interface ParsedQuote {
  intent: Intent;
  dims?: { l: number; w: number; h: number; units: Units };
  qty?: number;
  material?: Material;
  density?: number; // lb/ft^3 (optional)
  notes?: string[];
  // raw for debugging
  _debug?: Record<string, unknown>;
}

/** Normalize whitespace & lowercase for simpler matching */
function norm(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** Attempt to extract LxWxH in inches, e.g. "12x8x3", '12" x 8" x 3"' etc. */
function extractDims(text: string): ParsedQuote["dims"] | undefined {
  // 12x8x3, 12 x 8 x 3, 12”x8”x3”, 12in x 8in x 3in, 12"x8"x3"
  const dimRegex =
    /\b(\d+(?:\.\d+)?)\s*(?:\"|in|inch|inches)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:\"|in|inch|inches)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:\"|in|inch|inches)?\b/i;
  const m = text.match(dimRegex);
  if (!m) return;
  const l = parseFloat(m[1]);
  const w = parseFloat(m[2]);
  const h = parseFloat(m[3]);
  if (Number.isFinite(l) && Number.isFinite(w) && Number.isFinite(h)) {
    return { l, w, h, units: "in" };
  }
  return;
}

/** Extract quantity: "qty 50", "50 pcs", "x50", "quantity: 50" */
function extractQty(text: string): number | undefined {
  const patterns = [
    /\bqty\s*[:=]?\s*(\d+)\b/i,
    /\bquantity\s*[:=]?\s*(\d+)\b/i,
    /\b(\d+)\s*(?:pcs?|pieces)\b/i,
    /\bx\s*(\d+)\b/i,
  ];
  for (const r of patterns) {
    const m = text.match(r);
    if (m) {
      const q = parseInt(m[1], 10);
      if (Number.isFinite(q) && q > 0) return q;
    }
  }
  return;
}

/** Extract foam material */
function extractMaterial(text: string): Material | undefined {
  if (/EPE\b|PE\b/i.test(text)) return "EPE";
  if (/\bPU\b/i.test(text)) return "PU";
  if (/\bEVA\b/i.test(text)) return "EVA";
  if (/\bhoneycomb\b/i.test(text)) return "HONEYCOMB";
  return undefined;
}

/** Extract density like "1.7 lb", "1.7#", "1.7lb/ft3" */
function extractDensity(text: string): number | undefined {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|#)\b/i);
  if (m) {
    const d = parseFloat(m[1]);
    if (Number.isFinite(d)) return d;
  }
  return;
}

/** Very small intent classifier */
function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/(quote|price|estimate|cost|how much|pricing)/i.test(t)) return "estimate";
  if (/(hi|hello|good morning|good afternoon|thanks|thank you)/i.test(t)) return "greeting";
  if (/(re:|follow up|following up|any update|did you see)/i.test(t)) return "followup";
  return "unknown";
}

/** Parse a free-form message into structured fields we can price */
export function parseMessageForQuote(text: string): ParsedQuote {
  const cleaned = norm(text);
  const intent = detectIntent(cleaned);
  const dims = extractDims(cleaned);
  const qty = extractQty(cleaned);
  const material = extractMaterial(cleaned) ?? "UNKNOWN";
  const density = extractDensity(cleaned);

  const notes: string[] = [];
  if (!dims) notes.push("Missing dimensions (LxWxH in inches).");
  if (!qty) notes.push("Missing quantity (e.g., qty 50).");
  if (material === "UNKNOWN") notes.push("Material not specified; defaulting to EPE.");
  if (!density) notes.push("Density not specified; defaulting to 1.7 lb/ft³.");

  return {
    intent,
    dims,
    qty,
    material,
    density,
    notes,
    _debug: { cleaned },
  };
}
