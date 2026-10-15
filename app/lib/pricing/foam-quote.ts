// app/lib/pricing/foam-quote.ts
//
// Step 23: the foam pieces /api/quote/print and /api/admin/send-quote share,
// so the quote page and the quote email always show the same charges.
//   - latestLayoutJson(quoteId): the saved layout the buyer / staff applied
//   - foamChargeLines(...): cutting (CNC or die + press), lamination, or the
//     old flat die-cut fee, from the quote's locked charge settings

import { one } from "@/lib/db";
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
