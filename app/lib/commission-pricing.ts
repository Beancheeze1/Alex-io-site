// app/lib/commission-pricing.ts
//
// Shared helper for computing a quote's commission-eligible total.
// Mirrors app/api/quote/print/route.ts pricing exactly, including:
//   - PRE-APPLY quotes (no quote_items): price from Redis facts
//   - POST-APPLY quotes: price from quote_items (or calc if NULL)
//   - Box totals from quote_box_selections (always stored)
//   - Synthetic box from customer_box_in facts when no box row exists yet
//
// Used by:
//   - app/api/admin/commissions/route.ts  (live view)
//   - app/api/admin/commissions/payouts/route.ts  (month close snapshot)

import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseDims(dims: any): { L: number; W: number; H: number } | null {
  if (!dims) return null;
  if (typeof dims === "object") {
    const L = Number(dims.L), W = Number(dims.W), H = Number(dims.H);
    return [L, W, H].every((n) => Number.isFinite(n) && n > 0) ? { L, W, H } : null;
  }
  const [L, W, H] = String(dims).split("x").map((s) => Number(s.trim()));
  return [L, W, H].every((n) => Number.isFinite(n) && n > 0) ? { L, W, H } : null;
}

function isExcluded(notes: string | null): boolean {
  const n = String(notes || "").toUpperCase();
  return (
    n.includes("[LAYOUT-LAYER]") ||
    n.includes("[PACKAGING]") ||
    n.includes("REQUESTED SHIPPING CARTON")
  );
}

async function calcFoamTotal(
  base: string,
  L: number,
  W: number,
  H: number,
  qty: number,
  material_id: number,
): Promise<number> {
  try {
    const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        length_in: L, width_in: W, height_in: H,
        material_id, qty, cavities: [], round_to_bf: false,
      }),
    });
    const j = await r.json().catch(() => ({}));
    return safeNum(j?.result?.total) || safeNum(j?.result?.price_total) || safeNum(j?.total) || 0;
  } catch { return 0; }
}

// Mirrors findAndPriceClosestBox in print/route.ts
async function syntheticBoxTotal(
  insideL: number,
  insideW: number,
  insideH: number,
  qty: number,
): Promise<number> {
  try {
    type BoxRow = { id: number; sku: string };
    const candidates = await q<BoxRow>(
      `SELECT id, sku FROM public.boxes
       WHERE (
         (inside_length_in >= $1 AND inside_width_in >= $2 AND inside_height_in >= $3)
         OR
         (inside_length_in >= $2 AND inside_width_in >= $1 AND inside_height_in >= $3)
       )
       ORDER BY inside_length_in * inside_width_in * inside_height_in ASC
       LIMIT 1`,
      [insideL, insideW, insideH],
    );

    if (!candidates || candidates.length === 0) return 0;
    const best = candidates[0];

    type TierRow = {
      base_unit_price: string | null;
      tier1_min_qty: number | null; tier1_unit_price: string | null;
      tier2_min_qty: number | null; tier2_unit_price: string | null;
      tier3_min_qty: number | null; tier3_unit_price: string | null;
      tier4_min_qty: number | null; tier4_unit_price: string | null;
    };
    const tier = await one<TierRow>(
      `SELECT base_unit_price,
              tier1_min_qty, tier1_unit_price,
              tier2_min_qty, tier2_unit_price,
              tier3_min_qty, tier3_unit_price,
              tier4_min_qty, tier4_unit_price
       FROM public.box_price_tiers WHERE box_id = $1`,
      [best.id],
    ).catch(() => null);

    if (!tier) return 0;

    const safeN = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    let unitPrice: number | null = safeN(tier.base_unit_price);

    const tiers = [
      { min: tier.tier1_min_qty, unit: safeN(tier.tier1_unit_price) },
      { min: tier.tier2_min_qty, unit: safeN(tier.tier2_unit_price) },
      { min: tier.tier3_min_qty, unit: safeN(tier.tier3_unit_price) },
      { min: tier.tier4_min_qty, unit: safeN(tier.tier4_unit_price) },
    ].filter((t) => t.min != null && (t.min as number) > 0);

    for (const t of tiers) {
      if (t.unit != null && qty >= (t.min as number)) unitPrice = t.unit;
    }

    return unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : 0;
  } catch { return 0; }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getCommissionableTotal(
  quoteId: number,
  quoteNo: string,
  base: string,
): Promise<number> {
  // ── Foam items ──
  const items = await q<{
    length_in: string; width_in: string; height_in: string;
    qty: number; material_id: number; price_total_usd: string | null; notes: string | null;
  }>(
    `SELECT length_in, width_in, height_in, qty, material_id, price_total_usd, notes
     FROM public.quote_items WHERE quote_id = $1`,
    [quoteId],
  );

  // ── Box selections (always stored when a carton is committed) ──
  const boxes = await q<{ extended_price_usd: string | null }>(
    `SELECT extended_price_usd FROM public.quote_box_selections WHERE quote_id = $1`,
    [quoteId],
  );
  let boxTotal = boxes.reduce((s, b) => s + safeNum(b.extended_price_usd), 0);

  let foamTotal = 0;

  if (items.length === 0) {
    // PRE-APPLY: price from Redis facts
    const facts = (await loadFacts(quoteNo)) || {};
    const dims = parseDims((facts as any).dims);
    const qty = safeNum((facts as any).qty);
    const materialId = safeNum((facts as any).material_id);
    if (dims && qty > 0 && materialId > 0) {
      foamTotal = await calcFoamTotal(base, dims.L, dims.W, dims.H, qty, materialId);
    }

    // Synthetic box: if no committed box row but customer_box_in is set in facts
    if (boxes.length === 0) {
      const customerBox = parseDims((facts as any).customer_box_in);
      if (customerBox) {
        const synQty = qty > 0 ? qty : 1;
        boxTotal = await syntheticBoxTotal(customerBox.L, customerBox.W, customerBox.H, synQty);
      }
    }
  } else {
    // POST-APPLY: price each non-excluded item
    const prices = await Promise.all(
      items
        .filter((it) => !isExcluded(it.notes))
        .map(async (it) => {
          if (it.price_total_usd !== null && safeNum(it.price_total_usd) > 0) {
            return safeNum(it.price_total_usd);
          }
          const L = Number(it.length_in), W = Number(it.width_in), H = Number(it.height_in);
          const qty = Number(it.qty), materialId = Number(it.material_id);
          if (
            ![L, W, H].every((n) => Number.isFinite(n) && n > 0) ||
            !(qty > 0) || !(materialId > 0)
          ) return 0;
          return calcFoamTotal(base, L, W, H, qty, materialId);
        }),
    );
    foamTotal = prices.reduce((s, p) => s + p, 0);

    // Synthetic box check for post-apply too (edge case: apply before box committed)
    if (boxes.length === 0) {
      const facts = (await loadFacts(quoteNo)) || {};
      const customerBox = parseDims((facts as any).customer_box_in);
      if (customerBox) {
        const primaryQty = items.length > 0 ? (Number(items[0].qty) || 1) : 1;
        boxTotal = await syntheticBoxTotal(customerBox.L, customerBox.W, customerBox.H, primaryQty);
      }
    }
  }

  return Math.round((foamTotal + boxTotal) * 100) / 100;
}
