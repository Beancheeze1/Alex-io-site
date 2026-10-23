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
//
// Step 23: the lock also records the price MODEL. Quotes first priced before
// Step 23 (a lock without "model") stay on model 1: no cavity subtraction,
// the flat die-cut fee, no lamination, until staff reprice. New quotes are
// model 2, and their lock saves the foam cutting / lamination rates and the
// markup too. Model-2 foam lines with cavities add the cavity volume to the
// lock key, so a cavity change reprices the line.
//
// Step 39L: new locks also save foam_process.lam_rule = 2 (lamination counted
// sheet by sheet from the shop's stock thicknesses, foam-process.ts) and the
// stock thicknesses themselves.

import { one, q } from "@/lib/db";
import { LAM_RULE_SHEETS, pickFoamProcess, type FoamProcessSettings } from "@/app/lib/pricing/foam-process";

export type FoamLockInput = {
  L: number;
  W: number;
  H: number;
  qty: number;
  material_id: number;
  force_skived?: boolean;
  // Step 23 (model 2): cavity volume per piece; only added to the key when > 0,
  // so lines without cavities keep the key they already had.
  cavity_ci?: number | null;
};

export function foamLockKey(i: FoamLockInput): string {
  const base = [i.L, i.W, i.H, i.qty, i.material_id, i.force_skived ? 1 : 0].map((v) => String(v)).join("|");
  const cav = Number(i.cavity_ci);
  return Number.isFinite(cav) && cav > 0 ? `${base}|c${Math.round(cav * 100) / 100}` : base;
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
  // Step 23
  model: 1 | 2;
  markup_factor_default: number;
  foam_process: FoamProcessSettings;
};

function pickCharges(raw: unknown, defaultModel: 1 | 2): ChargeSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const model: 1 | 2 = s.model === 2 ? 2 : s.model === 1 ? 1 : defaultModel;
  return {
    printing_upcharge_usd: n(s.printing_upcharge_usd),
    printing_upcharge_pct: n(s.printing_upcharge_pct),
    die_cut_trigger_qty: n(s.die_cut_trigger_qty),
    die_cut_upcharge_usd: n(s.die_cut_upcharge_usd),
    model,
    markup_factor_default: n(s.markup_factor_default) > 0 ? n(s.markup_factor_default) : 1,
    // A model-1 lock has no foam rates: all 0, so nothing new is charged.
    foam_process: pickFoamProcess(s.foam_process ?? (model === 2 ? s : null)),
  };
}

/**
 * Step 23: the price model for a quote — 1 for quotes whose saved lock is
 * from before Step 23, 2 otherwise (a quote with no lock yet gets model 2
 * when its lock is saved). Read-only.
 */
export async function quotePriceModel(quoteNo: string): Promise<1 | 2> {
  try {
    const row = await one<{ price_lock: unknown }>(
      `SELECT price_lock FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    const lock = parseJson(row?.price_lock);
    if (lock && lock.charges && typeof lock.charges === "object") {
      return lock.charges.model === 2 ? 2 : 1;
    }
  } catch {
    // migration 031 not run: today's rules
  }
  return 2;
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
  const live = pickCharges(liveSettings, 2);
  // Step 39L: quotes priced from now on count lamination sheet by sheet; a
  // lock saved before 39L has no lam_rule and keeps the old count until a reprice.
  live.foam_process.lam_rule = LAM_RULE_SHEETS;
  try {
    const row = await one<{ price_lock: unknown }>(
      `SELECT price_lock FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    const lock = parseJson(row?.price_lock);
    if (lock && lock.charges && typeof lock.charges === "object") {
      // A lock saved before Step 23 has no "model": it stays on model 1.
      return pickCharges(lock.charges, 1);
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
