// app/lib/freight.ts
//
// Step 30: a quote's ship-to, freight terms and freight (rules in
// app/lib/freight-core.ts).
//   - loadShipTo(quoteId): the quote's ship-to columns (read through
//     to_jsonb, so it works before migration 041)
//   - shopFreightSettings(tenantId): the shop's freight table
//   - quoteLoad(quoteId, tenantId, facts): foam pieces and boxes to ship
//   - freightForQuote(...): all of it -> FreightResult, for /api/quote/print
//     and /api/admin/send-quote (so the quote page and the email agree)

import { one, q } from "@/lib/db";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import {
  cleanFreightSettings,
  cleanZip,
  estimateFreight,
  isFreightTerms,
  type BoxPiece,
  type FoamPiece,
  type FreightResult,
  type FreightSettings,
  type FreightTerms,
} from "@/app/lib/freight-core";

export type ShipTo = {
  terms: FreightTerms | null;
  name: string | null;
  company: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  account: string | null;
  override_usd: number | null;
};

export const EMPTY_SHIP_TO: ShipTo = {
  terms: null,
  name: null,
  company: null,
  line1: null,
  line2: null,
  city: null,
  state: null,
  zip: null,
  account: null,
  override_usd: null,
};

export async function loadShipTo(quoteId: number): Promise<ShipTo> {
  const row = await one<{ j: Record<string, unknown> | null }>(
    `SELECT to_jsonb(q) AS j FROM public.quotes q WHERE q.id = $1`,
    [quoteId],
  ).catch(() => null);
  const j = (row?.j || {}) as Record<string, unknown>;
  const s = (k: string) => (j[k] == null || String(j[k]).trim() === "" ? null : String(j[k]));
  const ov = j.freight_override_usd == null ? null : Number(j.freight_override_usd);
  return {
    terms: isFreightTerms(j.freight_terms) ? j.freight_terms : null,
    name: s("ship_to_name"),
    company: s("ship_to_company"),
    line1: s("ship_to_line1"),
    line2: s("ship_to_line2"),
    city: s("ship_to_city"),
    state: s("ship_to_state"),
    zip: s("ship_to_zip"),
    account: s("freight_account"),
    override_usd: ov != null && Number.isFinite(ov) ? ov : null,
  };
}

export async function shopFreightSettings(tenantId: number): Promise<FreightSettings> {
  try {
    const s = (await getPricingSettings(tenantId)) as unknown as Record<string, unknown>;
    return cleanFreightSettings(s.freight);
  } catch {
    return cleanFreightSettings(null);
  }
}

/** The quote's terms if the shop still allows them, else the shop default. */
export function effectiveTerms(shipTo: ShipTo, s: FreightSettings): FreightTerms {
  return shipTo.terms && s.terms_allowed.includes(shipTo.terms) ? shipTo.terms : s.default_terms;
}

function dimsOf(v: unknown): { L: number; W: number; H: number } | null {
  if (!v) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const L = Number(o.L ?? o.l ?? o.length);
    const W = Number(o.W ?? o.w ?? o.width);
    const H = Number(o.H ?? o.h ?? o.height);
    return L > 0 && W > 0 && H > 0 ? { L, W, H } : null;
  }
  const m = /([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i.exec(String(v));
  return m ? { L: Number(m[1]), W: Number(m[2]), H: Number(m[3]) } : null;
}

/** Foam pieces (saved lines, else the facts before Apply) and boxes on the quote. */
export async function quoteLoad(
  quoteId: number,
  tenantId: number,
  facts: Record<string, unknown> | null,
): Promise<{ foam: FoamPiece[]; boxes: BoxPiece[] }> {
  const items = await q<{ length_in: unknown; width_in: unknown; height_in: unknown; qty: unknown; density: unknown; notes: string | null }>(
    `SELECT qi.length_in, qi.width_in, qi.height_in, qi.qty, m.density_lb_ft3 AS density, qi.notes
       FROM public.quote_items qi
       LEFT JOIN public.materials m ON m.id = qi.material_id
      WHERE qi.quote_id = $1`,
    [quoteId],
  ).catch(() => []);
  let foam: FoamPiece[] = items
    // Same rows the foam price counts: not layer detail rows, not packaging rows.
    .filter((i) => {
      const n = String(i.notes || "");
      return !/\[LAYOUT-LAYER\]/i.test(n) && !n.includes("[PACKAGING]") && !/requested shipping carton/i.test(n);
    })
    .map((i) => ({
      l: Number(i.length_in) || 0,
      w: Number(i.width_in) || 0,
      h: Number(i.height_in) || 0,
      qty: Number(i.qty) || 0,
      density_pcf: i.density == null ? null : Number(i.density),
    }));
  if (foam.length === 0 && facts) {
    const d = dimsOf(facts.dims);
    const qty = Number(facts.qty) || 0;
    const mat = Number(facts.material_id) || 0;
    if (d && qty > 0) {
      const m = mat
        ? await one<{ density: unknown }>(`SELECT density_lb_ft3 AS density FROM public.materials WHERE id = $1`, [mat]).catch(() => null)
        : null;
      foam = [{ l: d.L, w: d.W, h: d.H, qty, density_pcf: m?.density == null ? null : Number(m.density) }];
    }
  }

  const boxRows = await q<{ qty: unknown; l: unknown; w: unknown; h: unknown; style: string | null; flute: string | null; caliper: unknown }>(
    `SELECT qbs.qty,
            COALESCE(b.inside_length_in, qbs.custom_length_in) AS l,
            COALESCE(b.inside_width_in, qbs.custom_width_in) AS w,
            COALESCE(b.inside_height_in, qbs.custom_height_in) AS h,
            COALESCE(b.style, qbs.custom_style) AS style,
            g.flute,
            f.caliper_in AS caliper
       FROM public.quote_box_selections qbs
       LEFT JOIN public.boxes b ON b.id = qbs.box_id
       LEFT JOIN public.corrugated_board_grades g ON g.id = (to_jsonb(qbs) ->> 'board_grade_id')::bigint
       LEFT JOIN public.corrugated_flutes f ON f.tenant_id = $2 AND f.flute = g.flute
      WHERE qbs.quote_id = $1`,
    [quoteId, tenantId],
  ).catch(() => []);
  const boxes: BoxPiece[] = boxRows.map((b) => ({
    l: Number(b.l) || 0,
    w: Number(b.w) || 0,
    h: Number(b.h) || 0,
    qty: Number(b.qty) || 0,
    style: b.style,
    flute: b.flute,
    caliper_in: b.caliper == null ? null : Number(b.caliper),
  }));
  return { foam, boxes };
}

export async function freightForQuote(args: {
  quoteId: number;
  tenantId: number;
  subtotal: number;
  facts?: Record<string, unknown> | null;
}): Promise<{ freight: FreightResult; shipTo: ShipTo; settings: FreightSettings }> {
  const [shipTo, settings] = await Promise.all([loadShipTo(args.quoteId), shopFreightSettings(args.tenantId)]);
  const terms = effectiveTerms(shipTo, settings);
  const load = settings.ship_from_zip || shipTo.override_usd != null
    ? await quoteLoad(args.quoteId, args.tenantId, args.facts ?? null)
    : { foam: [], boxes: [] };
  const freight = estimateFreight({
    s: settings,
    terms,
    toZip: cleanZip(shipTo.zip),
    foam: load.foam,
    boxes: load.boxes,
    subtotal: args.subtotal,
    overrideUsd: shipTo.override_usd,
  });
  return { freight, shipTo, settings };
}
