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
import { internalHeaders } from "@/lib/internal-call";
import { resolveBoxUnitPrice } from "@/app/lib/box-tier-pricing";

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
  tenant_id: number | null,
): Promise<number> {
  // Step 22: the calc route needs the quote's shop on internal calls.
  if (tenant_id == null) return 0;
  try {
    const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalHeaders() },
      body: JSON.stringify({
        length_in: L, width_in: W, height_in: H,
        material_id, qty, cavities: [], round_to_bf: false, tenant_id,
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
  tenantId: number | null,
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
       AND (tenant_id IS NULL OR tenant_id = $4)
       ORDER BY inside_length_in * inside_width_in * inside_height_in ASC
       LIMIT 1`,
      [insideL, insideW, insideH, tenantId],
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

    const unitPrice = resolveBoxUnitPrice(tier, qty);

    return unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : 0;
  } catch { return 0; }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getCommissionableTotal(
  quoteId: number,
  quoteNo: string,
  base: string,
  tenantId: number | null = null,
): Promise<number> {
  // Step 22: foam is priced with the quote's own shop settings.
  const shopId =
    tenantId ??
    (await one<{ tenant_id: number }>(`SELECT tenant_id FROM public.quotes WHERE id = $1`, [quoteId]).catch(() => null))
      ?.tenant_id ??
    null;

  // ── Foam items ──
  const items = await q<{
    length_in: string; width_in: string; height_in: string;
    qty: number; material_id: number; price_total_usd: string | null; notes: string | null;
    calc_snapshot: unknown;
  }>(
    `SELECT length_in, width_in, height_in, qty, material_id, price_total_usd, notes, calc_snapshot
     FROM public.quote_items WHERE quote_id = $1`,
    [quoteId],
  );

  // ── Box selections (always stored when a carton is committed) ──
  // Box totals include one-time printing plates (Chuck, Oct 2026). On
  // per-color quotes, print run + setup are already inside extended_price_usd.
  // plates_usd is read via to_jsonb so this works on any schema version.
  // Step 27: plus one-time cutting dies (tooling_usd).
  const boxes = await q<{ extended_price_usd: string | null; plates_usd: string | null; tooling_usd: string | null }>(
    `SELECT qbs.extended_price_usd, (to_jsonb(qbs) ->> 'plates_usd') AS plates_usd,
            (to_jsonb(qbs) ->> 'tooling_usd') AS tooling_usd
       FROM public.quote_box_selections qbs
      WHERE qbs.quote_id = $1`,
    [quoteId],
  );
  let boxTotal = boxes.reduce(
    (s, b) => s + safeNum(b.extended_price_usd) + safeNum(b.plates_usd) + safeNum(b.tooling_usd),
    0,
  );

  let foamTotal = 0;

  if (items.length === 0) {
    // PRE-APPLY: price from Redis facts
    const facts = (await loadFacts(quoteNo)) || {};
    const dims = parseDims((facts as any).dims);
    const qty = safeNum((facts as any).qty);
    const materialId = safeNum((facts as any).material_id);
    if (dims && qty > 0 && materialId > 0) {
      foamTotal = await calcFoamTotal(base, dims.L, dims.W, dims.H, qty, materialId, shopId);
    }

    // Synthetic box: if no committed box row but customer_box_in is set in facts
    if (boxes.length === 0) {
      const customerBox = parseDims((facts as any).customer_box_in);
      if (customerBox) {
        const synQty = qty > 0 ? qty : 1;
        boxTotal = await syntheticBoxTotal(customerBox.L, customerBox.W, customerBox.H, synQty, tenantId);
      }
    }
  } else {
    // POST-APPLY: price each non-excluded item
    const prices = await Promise.all(
      items
        .filter((it) => !isExcluded(it.notes))
        .map(async (it) => {
          const L = Number(it.length_in), W = Number(it.width_in), H = Number(it.height_in);
          const qty = Number(it.qty), materialId = Number(it.material_id);
          // Step 14: a saved foam price counts only while its lock (Step 10B,
          // size|qty|material) still matches the foam. After a foam change it
          // is stale until the quote is viewed again, so price it live instead.
          if (it.price_total_usd !== null && safeNum(it.price_total_usd) > 0) {
            let snap: unknown = it.calc_snapshot;
            if (typeof snap === "string") {
              try { snap = JSON.parse(snap); } catch { snap = null; }
            }
            const rawKey = snap && typeof snap === "object" ? (snap as { lock_key?: unknown }).lock_key : null;
            const lockKey = typeof rawKey === "string" ? rawKey : "";
            if (lockKey.split("|").slice(0, 5).join("|") === [L, W, H, qty, materialId].map(String).join("|")) {
              return safeNum(it.price_total_usd);
            }
          }
          if (
            ![L, W, H].every((n) => Number.isFinite(n) && n > 0) ||
            !(qty > 0) || !(materialId > 0)
          ) return 0;
          return calcFoamTotal(base, L, W, H, qty, materialId, shopId);
        }),
    );
    foamTotal = prices.reduce((s, p) => s + p, 0);

    // Synthetic box check for post-apply too (edge case: apply before box committed)
    if (boxes.length === 0) {
      const facts = (await loadFacts(quoteNo)) || {};
      const customerBox = parseDims((facts as any).customer_box_in);
      if (customerBox) {
        const primaryQty = items.length > 0 ? (Number(items[0].qty) || 1) : 1;
        boxTotal = await syntheticBoxTotal(customerBox.L, customerBox.W, customerBox.H, primaryQty, tenantId);
      }
    }
  }

  return Math.round((foamTotal + boxTotal) * 100) / 100;
}
