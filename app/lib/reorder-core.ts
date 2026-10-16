// app/lib/reorder-core.ts
//
// Step 34B: reorder and saved-address rules (pure: no DB, safe in the
// browser; tested in scripts/test-reorder.ts).
//   - cleanReorderInput(): the reorder dialog's quantities
//   - reorderFacts(): which quote facts carry over to the new quote
//   - addressKey() / savedAddresses(): the buyer's past ship-to addresses
// Copying the quote lives in app/lib/reorder.ts.

export const MAX_REORDER_QTY = 1_000_000;

export type ReorderSource = {
  foamSets: number | null; // null = no foam on the quote
  boxes: { id: number; qty: number }[];
};

export type ReorderInput = {
  foamQty: number | null; // null when there's no foam
  boxes: { id: number; qty: number }[]; // every source box line, 0 = leave it off
  artworkChanged: boolean;
};

function qtyOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_REORDER_QTY ? n : NaN;
}

/**
 * The dialog's answer, checked against the source quote. Missing quantities
 * keep the source's; a box line at 0 is left off; foam can't be 0 (use a
 * new quote instead); something has to be ordered.
 */
export function cleanReorderInput(
  raw: unknown,
  src: ReorderSource,
): { ok: true; value: ReorderInput } | { ok: false; field: string; message: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let foamQty: number | null = null;
  if (src.foamSets != null) {
    const q = qtyOf(b.foam_qty);
    if (q === null) foamQty = src.foamSets;
    else if (Number.isNaN(q) || q < 1) return { ok: false, field: "foam_qty", message: `Foam quantity must be a whole number from 1 to ${MAX_REORDER_QTY.toLocaleString("en-US")}.` };
    else foamQty = q;
  }
  const given = new Map<number, unknown>();
  if (Array.isArray(b.boxes)) {
    for (const x of b.boxes) {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const id = Number(o.id);
      if (!src.boxes.some((s) => s.id === id)) return { ok: false, field: "boxes", message: "One of the box lines isn't on this order." };
      given.set(id, o.qty);
    }
  }
  const boxes: { id: number; qty: number }[] = [];
  for (const s of src.boxes) {
    const q = given.has(s.id) ? qtyOf(given.get(s.id)) : s.qty;
    if (q === null) boxes.push({ id: s.id, qty: s.qty });
    else if (Number.isNaN(q)) return { ok: false, field: `box_${s.id}`, message: `Box quantities must be whole numbers from 0 to ${MAX_REORDER_QTY.toLocaleString("en-US")}.` };
    else boxes.push({ id: s.id, qty: q });
  }
  if (foamQty == null && !boxes.some((x) => x.qty > 0)) return { ok: false, field: "boxes", message: "Order at least one item." };
  return { ok: true, value: { foamQty, boxes, artworkChanged: b.artwork_changed === true } };
}

/** Facts that belong to the old quote's history, not its spec. */
export const DROP_FACT_KEYS = [
  "revision",
  "revision_updated_at",
  "released_rev",
  "stage_rev",
  "released_from_stage",
  "stage_pending_bump",
  "foam_qty_breaks",
  "box_qty_breaks",
  "reorder_of",
  "reorder_artwork_changed",
] as const;

/** The new quote's facts: the old spec, today's quantity, a note of where it came from. */
export function reorderFacts(
  src: Record<string, unknown>,
  opts: { srcQuoteNo: string; foamQty: number | null; artworkChanged: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src || {})) {
    if ((DROP_FACT_KEYS as readonly string[]).includes(k)) continue;
    if (/lock/i.test(k)) continue;
    out[k] = v;
  }
  if (opts.foamQty != null) out.qty = opts.foamQty;
  out.reorder_of = opts.srcQuoteNo;
  if (opts.artworkChanged) out.reorder_artwork_changed = true;
  return out;
}

/**
 * Foam a quote prices from its facts alone (a quote that was never applied
 * to a layout: dims, qty and material in the facts, no foam lines), the same
 * way the quote page does. Null for boxes-only quotes or incomplete facts.
 */
export function factsFoam(facts: Record<string, unknown> | null | undefined): { sets: number; label: string } | null {
  const f = facts || {};
  if (f.pack_type === "boxes_only") return null;
  const qty = Number(f.qty);
  const mat = Number(f.material_id);
  if (!Number.isInteger(qty) || qty < 1 || !(mat > 0)) return null;
  let L: number, W: number, H: number;
  const d = f.dims;
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    L = Number(o.L ?? o.l ?? o.length);
    W = Number(o.W ?? o.w ?? o.width);
    H = Number(o.H ?? o.h ?? o.height);
  } else {
    const m = /([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i.exec(String(d ?? ""));
    if (!m) return null;
    L = Number(m[1]);
    W = Number(m[2]);
    H = Number(m[3]);
  }
  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return null;
  const n = (v: number) => String(Number(v.toFixed(4)));
  const name = typeof f.material_name === "string" && f.material_name.trim() ? `, ${f.material_name.trim()}` : "";
  return { sets: qty, label: `${n(L)} x ${n(W)} x ${n(H)} in${name}` };
}

/** Packaging rows that followed the foam quantity keep following it. */
export function itemQty(row: { qty: number; isPackaging: boolean }, oldFoam: number | null, newFoam: number | null): number {
  if (newFoam == null || oldFoam == null) return row.qty;
  if (!row.isPackaging) return newFoam;
  return row.qty === oldFoam ? newFoam : row.qty;
}

export type SavedAddress = {
  key: string;
  name: string | null;
  company: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string;
  label: string; // one line for the picker
};

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Same address = same street, city, state and ZIP, ignoring case and spacing. */
export function addressKey(a: { line1?: unknown; line2?: unknown; city?: unknown; state?: unknown; zip?: unknown }): string {
  return [a.line1, a.line2, a.city, a.state, String(a.zip ?? "").slice(0, 5)].map((v) => clean(v).toLowerCase()).join("|");
}

/**
 * The buyer's past ship-to addresses, newest first, one per address, without
 * the ones they removed. Rows without a ZIP are skipped. Up to `max`.
 */
export function savedAddresses(
  rows: { name?: unknown; company?: unknown; line1?: unknown; line2?: unknown; city?: unknown; state?: unknown; zip?: unknown }[],
  hidden: Set<string>,
  max = 10,
): SavedAddress[] {
  const seen = new Set<string>();
  const out: SavedAddress[] = [];
  for (const r of rows) {
    const zip = clean(r.zip);
    if (!/^\d{5}/.test(zip)) continue;
    const key = addressKey(r);
    if (seen.has(key) || hidden.has(key)) continue;
    seen.add(key);
    const s = (v: unknown) => clean(v) || null;
    const a = { name: s(r.name), company: s(r.company), line1: s(r.line1), line2: s(r.line2), city: s(r.city), state: s(r.state), zip };
    const place = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    out.push({ key, ...a, label: [a.company || a.name, a.line1, place].filter(Boolean).join(", ") || zip });
    if (out.length >= max) break;
  }
  return out;
}
