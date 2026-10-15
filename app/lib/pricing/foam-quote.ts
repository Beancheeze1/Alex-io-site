// app/lib/pricing/foam-quote.ts
//
// Step 23: the foam pieces /api/quote/print and /api/admin/send-quote share,
// so the quote page and the quote email always show the same charges.
//   - latestLayoutJson(quoteId): the saved layout the buyer / staff applied
//   - foamChargeLines(...): cutting (CNC or die + press), lamination, or the
//     old flat die-cut fee, from the quote's locked charge settings

import { one, q } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { reviewFoam, type ReviewFlag } from "@/app/lib/pricing/foam-review";
import type { ChargeSettings } from "@/app/lib/pricing/foam-lock";
import { foamGeometry, type FoamGeometry } from "@/app/lib/pricing/foam-geometry";
import { parseFoamRunChoice, priceFoamProcess, type FoamProcessResult } from "@/app/lib/pricing/foam-process";

export async function latestLayoutJson(quoteId: number): Promise<unknown | null> {
  try {
    const row = await one<{ layout_json: unknown }>(
      `SELECT layout_json FROM public.quote_layout_packages
        WHERE quote_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [quoteId],
    );
    const lj = row?.layout_json;
    if (typeof lj === "string") {
      try {
        return JSON.parse(lj);
      } catch {
        return null;
      }
    }
    return lj ?? null;
  } catch {
    return null;
  }
}

/** Geometry for the quote's billable foam set (PRIMARY line dims as the fallback). */
export function quoteFoamGeometry(layout: unknown, primary: { L: number; W: number; H: number }): FoamGeometry {
  return foamGeometry(layout, primary);
}

/**
 * Cutting / lamination / legacy die-cut lines for the quote. `geom` is the
 * billable foam set's geometry (null on a quote with no foam: no cutting or
 * lamination lines; the old flat fee still follows `legacyQty`).
 */
export function foamChargeLines(args: {
  settings: ChargeSettings;
  geom: FoamGeometry | null;
  qty: number;
  /** The order qty the old flat die-cut fee has always used (first line on the quote). */
  legacyQty: number;
  facts: Record<string, unknown> | null | undefined;
}): FoamProcessResult {
  const f = (args.facts || {}) as Record<string, unknown>;
  const geom = args.geom ?? foamGeometry(null, { L: 0, W: 0, H: 0 });
  const qty = args.geom ? args.qty : 0;
  return priceFoamProcess({
    model: args.settings.model,
    geom,
    qty,
    settings: args.settings.foam_process,
    markup: args.settings.markup_factor_default,
    choice: parseFoamRunChoice(f.foam_run_method),
    dieOwned: f.foam_die_owned === true,
    legacy: {
      trigger_qty: args.settings.die_cut_trigger_qty,
      upcharge_usd: args.settings.die_cut_upcharge_usd,
      qty: args.legacyQty,
    },
  });
}

/**
 * Step 25: review flags for a quote (cavities, thin walls, oversize, foam vs.
 * box fit, unpriced material) from its saved layout, its billable foam line,
 * its boxes and the shop's current review settings. [] for quotes with no foam.
 */
export async function quoteReviewFlags(quoteId: number, quoteNo: string, tenantId: number): Promise<ReviewFlag[]> {
  try {
    const items = await q<{
      length_in: string;
      width_in: string;
      height_in: string;
      qty: number;
      notes: string | null;
      calc_snapshot: unknown;
    }>(
      `SELECT length_in, width_in, height_in, qty, notes, calc_snapshot
         FROM public.quote_items WHERE quote_id = $1 ORDER BY id ASC`,
      [quoteId],
    );
    const primary = items.find((it) => {
      const n = String(it.notes || "");
      return (
        !n.startsWith("[LAYOUT-LAYER]") &&
        !n.startsWith("[PACKAGING]") &&
        !/^requested shipping carton:/i.test(n) &&
        Number(it.length_in) > 0 &&
        Number(it.width_in) > 0
      );
    });
    if (!primary) return [];

    const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, unknown>;
    const settings = await getPricingSettings(tenantId);
    const layout = await latestLayoutJson(quoteId);
    const boxes = await q<{ l: string | null; w: string | null; h: string | null; label: string | null }>(
      `SELECT coalesce(b.inside_length_in, qbs.custom_length_in) AS l,
              coalesce(b.inside_width_in, qbs.custom_width_in) AS w,
              coalesce(b.inside_height_in, qbs.custom_height_in) AS h,
              coalesce(qbs.sku, qbs.description, b.description) AS label
         FROM public.quote_box_selections qbs
         LEFT JOIN public.boxes b ON b.id = qbs.box_id
        WHERE qbs.quote_id = $1`,
      [quoteId],
    );
    let snap: unknown = primary.calc_snapshot;
    if (typeof snap === "string") {
      try {
        snap = JSON.parse(snap);
      } catch {
        snap = null;
      }
    }
    const detail = snap && typeof snap === "object" ? (snap as { detail?: { needs_review?: unknown } }).detail : null;

    return reviewFoam({
      layout,
      fallback: { L: Number(primary.length_in), W: Number(primary.width_in), H: Number(primary.height_in) },
      settings,
      boxes: boxes.map((b) => ({ L: Number(b.l), W: Number(b.w), H: Number(b.h), label: b.label })),
      completePack: boxes.length > 0 && facts.pack_type !== "boxes_only",
      materialUnpriced: detail?.needs_review === true,
    });
  } catch (e) {
    console.warn("[foam-quote] review flags unavailable", { quoteNo, err: String(e) });
    return [];
  }
}
