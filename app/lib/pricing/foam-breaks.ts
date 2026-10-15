// app/lib/pricing/foam-breaks.ts
//
// Step 24: foam "Price by quantity" — the price of a foam quote (foam-only or
// complete pack) at each compare quantity, like boxes-only (Step 5).
//
// Compare quantities: facts.foam_qty_breaks (picked at Start Quote, saved by
// the first Apply) plus the rep form's quotes.qty_breaks, plus the quantity on
// the quote. Up to 3 others; at least 2 in all, or there's nothing to compare.
//
// Each quantity is priced the way the quote page prices the quote:
//   foam      the billable foam set (cavities off the volume on model-2 quotes)
//   cutting   CNC / die + press / lamination (or the old flat die-cut fee) —
//             recalculated per quantity, so auto can switch CNC ↔ die
//   boxes     complete packs: every box at that quantity (+ one-time plates)
// using the quote's saved charge settings. The quantity already on the
// quote shows its saved (price-locked) foam and box prices.

import { one, q } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { computePricing } from "@/app/lib/pricing/compute";
import { foamLockKey, lockedChargeSettings } from "@/app/lib/pricing/foam-lock";
import { foamChargeLines, latestLayoutJson, quoteFoamGeometry } from "@/app/lib/pricing/foam-quote";
import { parsePrintSpec } from "@/lib/corrugated-price";
import { priceQuoteBoxesAtQtys } from "@/app/lib/packaging-selection";
import { cleanQtyList, foamBreakList } from "@/app/lib/pricing/qty-list";

export { cleanQtyList, foamBreakList };

export type FoamBreakRow = {
  qty: number;
  foam_usd: number;
  cutting_usd: number;
  method: "cnc" | "die" | "legacy" | "none";
  boxes_usd: number | null;
  plates_usd: number;
  total_usd: number;
  unit_usd: number;
  stored: boolean;
};

export type FoamBreaks = {
  ok: true;
  current_qty: number | null;
  locked: boolean;
  has_boxes: boolean;
  printing_extra: boolean;
  breaks: FoamBreakRow[];
};

type ItemRow = {
  id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number | null;
  notes: string | null;
  price_total_usd: string | null;
  calc_snapshot: unknown;
};

function isLayerRow(notes: string | null) {
  return String(notes || "").startsWith("[LAYOUT-LAYER]");
}
function isPackagingRow(notes: string | null) {
  const n = String(notes || "");
  return n.startsWith("[PACKAGING]") || /^requested shipping carton:/i.test(n);
}
function nonWholeInch(h: unknown) {
  const x = Number(h);
  return Number.isFinite(x) && Math.abs(x - Math.round(x)) > 0.01;
}
function r2(v: number) {
  return Math.round(v * 100) / 100;
}
function parseSnap(v: unknown): { lock_key?: string } | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? (v as { lock_key?: string }) : null;
}

const EMPTY = (locked: boolean): FoamBreaks => ({
  ok: true,
  current_qty: null,
  locked,
  has_boxes: false,
  printing_extra: false,
  breaks: [],
});

/** The quote's compare quantities, or [] (boxes-only quotes use /api/quote/box-breaks). */
export async function foamBreakQtys(quoteNo: string): Promise<{ quoteId: number; current: number; list: number[] } | null> {
  const quote = await one<{ id: number; qty_breaks: unknown }>(
    `SELECT id, qty_breaks FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote) return null;
  const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, unknown>;
  if (facts.pack_type === "boxes_only") return null;
  const items = await q<ItemRow>(
    `SELECT id, length_in, width_in, height_in, qty, material_id, notes, price_total_usd, calc_snapshot
       FROM public.quote_items WHERE quote_id = $1 ORDER BY id ASC`,
    [quote.id],
  );
  const primary = items.find((it) => !isLayerRow(it.notes) && !isPackagingRow(it.notes) && Number(it.qty) > 0);
  if (!primary) return null;
  const current = Number(primary.qty);
  const list = foamBreakList(current, cleanQtyList([...cleanQtyList(facts.foam_qty_breaks), ...cleanQtyList(quote.qty_breaks)]));
  return { quoteId: Number(quote.id), current, list };
}

export async function foamBreaksForQuote(quoteNo: string): Promise<FoamBreaks | null> {
  const quote = await one<{ id: number; tenant_id: number; locked: boolean | null; qty_breaks: unknown }>(
    `SELECT id, tenant_id, locked, qty_breaks FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote) return null;
  const locked = !!quote.locked;
  const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, unknown>;
  if (facts.pack_type === "boxes_only") return EMPTY(locked);

  const items = await q<ItemRow>(
    `SELECT id, length_in, width_in, height_in, qty, material_id, notes, price_total_usd, calc_snapshot
       FROM public.quote_items WHERE quote_id = $1 ORDER BY id ASC`,
    [quote.id],
  );
  const primary = items.find(
    (it) =>
      !isLayerRow(it.notes) &&
      !isPackagingRow(it.notes) &&
      Number(it.length_in) > 0 &&
      Number(it.width_in) > 0 &&
      Number(it.height_in) > 0 &&
      Number(it.qty) > 0 &&
      Number(it.material_id) > 0,
  );
  if (!primary) return EMPTY(locked);

  const current = Number(primary.qty);
  const list = foamBreakList(current, cleanQtyList([...cleanQtyList(facts.foam_qty_breaks), ...cleanQtyList(quote.qty_breaks)]));
  if (list.length < 2) return { ...EMPTY(locked), current_qty: current };

  const tenantId = Number(quote.tenant_id);
  const settings = await lockedChargeSettings(quoteNo, await getPricingSettings(tenantId), false);
  const L = Number(primary.length_in);
  const W = Number(primary.width_in);
  const H = Number(primary.height_in);
  const materialId = Number(primary.material_id);
  const geom = quoteFoamGeometry(await latestLayoutJson(quote.id), { L, W, H });
  const cavityCi = settings.model === 2 ? geom.cavity_ci : 0;
  const forceSkive = items.some((it) => isLayerRow(it.notes)) && items.some((it) => isLayerRow(it.notes) && nonWholeInch(it.height_in));

  // Boxes (complete packs): every box at each quantity.
  const boxRows = await q<{ ext: string | null; plates: string | null; tooling: string | null }>(
    `SELECT extended_price_usd AS ext, (to_jsonb(qbs) ->> 'plates_usd') AS plates,
            (to_jsonb(qbs) ->> 'tooling_usd') AS tooling
       FROM public.quote_box_selections qbs WHERE quote_id = $1`,
    [quote.id],
  );
  const hasBoxes = boxRows.length > 0;
  const boxAt = new Map<number, { boxes: number | null; plates: number }>();
  if (hasBoxes) {
    const printArg = facts.print_mode === "per_box" ? "per_box" : parsePrintSpec(facts.print_spec);
    try {
      const priced = await priceQuoteBoxesAtQtys(Number(quote.id), tenantId, printArg, list);
      // Step 27: one-time cutting dies count with the plates.
      for (const p of priced) boxAt.set(p.qty, { boxes: p.boxes_usd, plates: r2((Number(p.plates_usd) || 0) + (Number(p.tooling_usd) || 0)) });
    } catch (e) {
      console.warn("[foam-breaks] box prices unavailable", { quoteNo, err: String(e) });
    }
    // The quantity on the quote: its saved box prices.
    if (!boxRows.some((r) => r.ext == null)) {
      boxAt.set(current, {
        boxes: r2(boxRows.reduce((s, r) => s + Number(r.ext || 0), 0)),
        plates: r2(boxRows.reduce((s, r) => s + Number(r.plates || 0) + Number(r.tooling || 0), 0)),
      });
    }
  }

  const breaks: FoamBreakRow[] = [];
  for (const qty of list) {
    let foam: number | null = null;
    let stored = false;
    if (qty === current) {
      const snap = parseSnap(primary.calc_snapshot);
      const key = foamLockKey({ L, W, H, qty, material_id: materialId, force_skived: forceSkive, cavity_ci: cavityCi });
      if (snap?.lock_key === key && primary.price_total_usd != null && Number(primary.price_total_usd) > 0) {
        foam = Number(primary.price_total_usd);
        stored = true;
      }
    }
    if (foam == null) {
      try {
        const p = await computePricing({
          L,
          W,
          H,
          qty,
          material_id: materialId,
          force_skived: forceSkive,
          cavity_ci: cavityCi,
          tenant_id: tenantId,
        });
        foam = p.total;
      } catch (e) {
        console.warn("[foam-breaks] foam price failed", { quoteNo, qty, err: String(e) });
        continue;
      }
    }
    const proc = foamChargeLines({ settings, geom, qty, legacyQty: qty, facts });
    const box = boxAt.get(qty);
    const boxes = hasBoxes ? (box?.boxes ?? null) : null;
    const plates = hasBoxes ? (box?.plates ?? 0) : 0;
    const total = r2(foam + proc.total + (boxes ?? 0) + plates);
    breaks.push({
      qty,
      foam_usd: r2(foam),
      cutting_usd: proc.total,
      method: proc.method,
      boxes_usd: boxes,
      plates_usd: plates,
      total_usd: total,
      unit_usd: Math.round((total / qty) * 10000) / 10000,
      stored,
    });
  }

  // Legacy printing (art setup + %) is added on the quote, not per quantity here.
  const printingExtra = !facts.print_spec && (facts.printed === 1 || facts.printed === true || facts.printed === "1");

  return { ok: true, current_qty: current, locked, has_boxes: hasBoxes, printing_extra: printingExtra, breaks };
}
