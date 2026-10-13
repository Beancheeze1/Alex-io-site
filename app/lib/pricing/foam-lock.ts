// app/lib/pricing/foam-lock.ts
//
// Step 10B: price lock for foam and quote charges.
//
// Foam: the first time a foam line is priced, its price is saved on the
// quote_items row together with a "lock key" (size, qty, material, skive).
// Later views, emails and commissions use the saved price while the key still
// matches. When the foam itself changes (Apply with a new size, material or
// quantity) the key no longer matches, so the line is priced again at today's
// rates and that new price is saved. Staff can clear the lock with
// POST /api/admin/quotes/reprice ("Reprice at today's rates").
//
// Charges: the printing (art setup fee + %) and die-cut settings in force the
// first time a quote is priced are saved in quotes.price_lock (migration 031)
// and used from then on, until staff reprice.

import { one, q } from "@/lib/db";

export type FoamLockInput = {
  L: number;
  W: number;
  H: number;
  qty: number;
  material_id: number;
  force_skived?: boolean;
};

export function foamLockKey(i: FoamLockInput): string {
  return [i.L, i.W, i.H, i.qty, i.material_id, i.force_skived ? 1 : 0].map((v) => String(v)).join("|");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(v: unknown): any {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? v : null;
}

type StoredFoamItem = {
  id: number | string;
  price_unit_usd?: unknown;
  price_total_usd?: unknown;
  calc_snapshot?: unknown;
};

/**
 * The saved price when the line hasn't changed since it was priced; otherwise
 * prices it now with `priceLive` and saves that price as the new lock.
 * `detail` is the calc breakdown saved with the price (kerf, minimum charge,
 * volumes), used by the quote email.
 */
export async function lockedFoamPrice(
  item: StoredFoamItem,
  input: FoamLockInput,
  priceLive: () => Promise<{ unit: number; total: number; detail?: unknown }>,
): Promise<{ unit: number; total: number; locked: boolean; detail: unknown }> {
  const key = foamLockKey(input);
  const snap = parseJson(item.calc_snapshot);
  const storedTotal = item.price_total_usd == null ? NaN : Number(item.price_total_usd);

  if (snap && snap.lock_key === key && Number.isFinite(storedTotal)) {
    const storedUnit = item.price_unit_usd == null ? NaN : Number(item.price_unit_usd);
    return {
      // The unit column holds 2 decimals; the total is exact, so derive the unit from it.
      unit: input.qty > 0 ? storedTotal / input.qty : Number.isFinite(storedUnit) ? storedUnit : 0,
      total: storedTotal,
      locked: true,
      detail: snap.detail ?? null,
    };
  }

  const live = await priceLive();
  const id = Number(item.id);
  // Only a real price is saved (a failed calc comes back as 0 and must not be locked in).
  if (Number.isFinite(id) && id > 0 && Number(live.total) > 0) {
    try {
      await q(
        `UPDATE public.quote_items
            SET price_unit_usd = $2,
                price_total_usd = $3,
                calc_snapshot = $4
          WHERE id = $1`,
        [
          id,
          live.unit,
          live.total,
          JSON.stringify({ lock_key: key, priced_at: new Date().toISOString(), detail: live.detail ?? null }),
        ],
      );
    } catch (e) {
      console.warn("[foam-lock] could not save the foam price", { id, err: String(e) });
    }
  }
  return { unit: live.unit, total: live.total, locked: false, detail: live.detail ?? null };
}

export type ChargeSettings = {
  printing_upcharge_usd: number;
  printing_upcharge_pct: number;
  die_cut_trigger_qty: number;
  die_cut_upcharge_usd: number;
};

function pickCharges(raw: unknown): ChargeSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    printing_upcharge_usd: n(s.printing_upcharge_usd),
    printing_upcharge_pct: n(s.printing_upcharge_pct),
    die_cut_trigger_qty: n(s.die_cut_trigger_qty),
    die_cut_upcharge_usd: n(s.die_cut_upcharge_usd),
  };
}

/**
 * The printing / die-cut settings saved with the quote, or today's settings
 * (saved now when `canSave`, i.e. the quote has priced lines or boxes).
 * Falls back to today's settings if migration 031 hasn't run yet.
 */
export async function lockedChargeSettings(
  quoteNo: string,
  liveSettings: unknown,
  canSave: boolean,
): Promise<ChargeSettings> {
  const live = pickCharges(liveSettings);
  try {
    const row = await one<{ price_lock: unknown }>(
      `SELECT price_lock FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    const lock = parseJson(row?.price_lock);
    if (lock && lock.charges && typeof lock.charges === "object") {
      return pickCharges(lock.charges);
    }
    if (row && canSave) {
      await q(
        `UPDATE public.quotes SET price_lock = $2 WHERE quote_no = $1 AND price_lock IS NULL`,
        [quoteNo, JSON.stringify({ charges: live, at: new Date().toISOString() })],
      );
    }
  } catch (e) {
    console.warn("[foam-lock] charge lock unavailable; using current settings", { quoteNo, err: String(e) });
  }
  return live;
}
