// app/lib/pricing/foam-process.ts
//
// Step 23: foam cutting + lamination charges (pure — no DB).
//
// Run method (like corrugated short runs, Step 15):
//   - "cnc" (short run: CNC / waterjet / knife, no tooling)
//       setup + qty × (cut inches per piece ÷ feed in/min) × machine $/min
//   - "die" (production: steel-rule die + press)
//       die (one-time, per part): Σ over each different layer pattern of
//         die base fee + rule inches × $/inch of rule
//         — $0 when the customer already owns the die (die_owned)
//       press: press setup + hits ÷ hits per hour × press $/hour,
//         hits = qty × layers cut ÷ parts per hit (rounded up)
//   - auto: "die" at or above the shop's foam_die_over_qty (when dies are set
//     up), else "cnc"; staff can force either (facts.foam_run_method).
// Lamination: setup + qty × glue lines × $/glue line (loose layers excluded).
// Step 39L: a quote whose lock has lam_rule 2 (every quote priced from Step
// 39L on) counts glue lines, sheets cut, dies and CNC cut sheet by sheet from
// the shop's stock sheet thicknesses (foam_stock_1_in … foam_stock_4_in):
// a glue line at every cavity floor plus the build-up, see withSheets() in
// foam-geometry.ts. Older locks (lam_rule 0) keep the layer count.
// All rates are the shop's COST; the shop markup (markup_factor_default) is
// applied, the same way it is to foam material.
//
// Shops that haven't set any CNC or die rates keep the old flat die-cut fee
// (die_cut_upcharge_usd once qty ≥ die_cut_trigger_qty). Quotes first priced
// before Step 23 (price model 1) also keep the old fee and no lamination.

import { cleanStockList, withSheets, type FoamGeometry } from "@/app/lib/pricing/foam-geometry";

export const FOAM_PROCESS_KEYS = [
  "foam_die_over_qty",
  "cnc_setup_usd",
  "cnc_feed_in_per_min",
  "cnc_cost_per_min",
  "die_base_usd",
  "die_rule_per_in_usd",
  "press_setup_usd",
  "press_rate_per_hr",
  "press_hits_per_hr",
  "press_parts_per_hit",
  "lam_setup_usd",
  "lam_per_glue_line_usd",
  // Step 39L: stock sheet thicknesses the shop laminates from (0 = not used)
  "foam_stock_1_in",
  "foam_stock_2_in",
  "foam_stock_3_in",
  "foam_stock_4_in",
] as const;
export type FoamProcessKey = (typeof FOAM_PROCESS_KEYS)[number];
/**
 * lam_rule (Step 39L) isn't a shop setting: the quote's lock records it.
 * 2 = sheet-by-sheet lamination (withSheets); 0 = a lock saved before 39L.
 */
export type FoamProcessSettings = Record<FoamProcessKey, number> & { lam_rule: number };
export const LAM_RULE_SHEETS = 2;

/** Step 39L: the shop's stock sheet thicknesses, thickest first. */
export function foamStockList(s: FoamProcessSettings): number[] {
  return cleanStockList([s.foam_stock_1_in, s.foam_stock_2_in, s.foam_stock_3_in, s.foam_stock_4_in]);
}

export type FoamRunMethod = "cnc" | "die";
export type FoamRunChoice = "auto" | FoamRunMethod;

export type ProcessLine = {
  key: "cnc" | "die" | "press" | "lamination" | "die_cut_legacy";
  label: string;
  amount: number;
  note: string | null;
};

export type FoamProcessResult = {
  model: 1 | 2;
  method: FoamRunMethod | "legacy" | "none";
  lines: ProcessLine[];
  total: number;
  detail: {
    qty: number;
    cut_in_per_piece: number;
    cnc_minutes: number | null;
    rule_in_total: number;
    dies: number;
    die_owned: boolean;
    press_hits: number | null;
    glue_lines: number;
    /** Step 39B: staff chose a method whose rates aren't set (no charge added for it). */
    missing_rates: FoamRunMethod | null;
  };
};

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function pickFoamProcess(raw: unknown): FoamProcessSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as FoamProcessSettings;
  for (const k of FOAM_PROCESS_KEYS) out[k] = num(s[k]);
  if (!out.press_parts_per_hit) out.press_parts_per_hit = 1;
  out.lam_rule = num(s.lam_rule);
  return out;
}

export function cncOn(s: FoamProcessSettings): boolean {
  return s.cnc_feed_in_per_min > 0 && s.cnc_cost_per_min > 0;
}
export function dieOn(s: FoamProcessSettings): boolean {
  return s.die_rule_per_in_usd > 0 || s.die_base_usd > 0;
}
export function lamOn(s: FoamProcessSettings): boolean {
  return s.lam_per_glue_line_usd > 0 || s.lam_setup_usd > 0;
}

export function parseFoamRunChoice(v: unknown): FoamRunChoice {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "cnc" || t === "die" ? t : "auto";
}

/** The cutting method for this quantity (null = the shop hasn't set up CNC or die rates). */
export function resolveFoamMethod(choice: FoamRunChoice, qty: number, s: FoamProcessSettings): FoamRunMethod | null {
  const c = cncOn(s);
  const d = dieOn(s);
  if (!c && !d) return null;
  // Step 39B: the staff choice always stands. CNC chosen with no CNC rates no
  // longer falls back to a steel-rule die (a die on parts meant to be CNC cut);
  // the quote shows no CNC charge and the admin control warns.
  if (choice === "cnc") return "cnc";
  if (choice === "die") return "die";
  if (d && (!c || (s.foam_die_over_qty > 0 && qty >= s.foam_die_over_qty))) return "die";
  return c ? "cnc" : "die";
}

export function priceFoamProcess(args: {
  model: 1 | 2;
  geom: FoamGeometry;
  qty: number;
  settings: FoamProcessSettings;
  markup: number;
  choice?: FoamRunChoice;
  dieOwned?: boolean;
  // The old flat fee keeps its old rule: the quote's order qty (first line).
  legacy: { trigger_qty: number; upcharge_usd: number; qty: number };
}): FoamProcessResult {
  const s = args.settings;
  // Step 39L: sheet-by-sheet lamination for quotes locked under the new rule.
  const geom = args.model === 2 && s.lam_rule >= LAM_RULE_SHEETS ? withSheets(args.geom, foamStockList(s)) : args.geom;
  const qty = Math.max(0, Math.floor(Number(args.qty) || 0));
  const mk = Number.isFinite(args.markup) && args.markup > 0 ? args.markup : 1;
  const lines: ProcessLine[] = [];
  const detail: FoamProcessResult["detail"] = {
    qty,
    cut_in_per_piece: geom.cut_in_per_piece,
    cnc_minutes: null,
    rule_in_total: geom.rule_in_total,
    dies: geom.dies.length,
    die_owned: args.dieOwned === true,
    press_hits: null,
    glue_lines: geom.glue_lines,
    missing_rates: null,
  };

  const legacyLine = (): ProcessLine | null => {
    const t = num(args.legacy.trigger_qty);
    const fee = num(args.legacy.upcharge_usd);
    const lq = Math.max(0, Math.floor(Number(args.legacy.qty) || 0));
    return t > 0 && fee > 0 && lq >= t
      ? { key: "die_cut_legacy", label: "Die-cutting", amount: r2(fee), note: `Applied at qty ≥ ${t}` }
      : null;
  };

  let method: FoamProcessResult["method"] = "none";

  if (args.model === 1) {
    const l = legacyLine();
    if (l) {
      lines.push(l);
      method = "legacy";
    }
  } else {
    const m = qty > 0 ? resolveFoamMethod(args.choice ?? "auto", qty, s) : null;
    if (m === "cnc" && !cncOn(s)) {
      method = "cnc";
      detail.missing_rates = "cnc";
    } else if (m === "die" && !dieOn(s)) {
      method = "die";
      detail.missing_rates = "die";
    } else if (m === "cnc") {
      method = "cnc";
      const minutes = s.cnc_feed_in_per_min > 0 ? (geom.cut_in_per_piece / s.cnc_feed_in_per_min) * qty : 0;
      detail.cnc_minutes = Math.round(minutes * 10) / 10;
      const cost = s.cnc_setup_usd + minutes * s.cnc_cost_per_min;
      lines.push({
        key: "cnc",
        label: "CNC cutting (short run, no tooling)",
        amount: r2(cost * mk),
        note: `${geom.cut_in_per_piece.toFixed(1)}" of cut per part`,
      });
    } else if (m === "die") {
      method = "die";
      const dieCost = geom.dies.reduce((sum, d) => sum + s.die_base_usd + d.rule_in * s.die_rule_per_in_usd, 0);
      lines.push({
        key: "die",
        label: geom.dies.length > 1 ? `Steel-rule dies (${geom.dies.length}, one-time)` : "Steel-rule die (one-time)",
        amount: args.dieOwned ? 0 : r2(dieCost * mk),
        note: args.dieOwned ? "Customer's die on file" : `${geom.rule_in_total.toFixed(1)}" of rule`,
      });
      const perHit = Math.max(1, Math.floor(s.press_parts_per_hit) || 1);
      const hits = Math.ceil((qty * geom.layers_cut) / perHit);
      detail.press_hits = hits;
      const pressRun = s.press_hits_per_hr > 0 ? (hits / s.press_hits_per_hr) * s.press_rate_per_hr : 0;
      const pressCost = s.press_setup_usd + pressRun;
      if (pressCost > 0) {
        lines.push({
          key: "press",
          label: "Die-cutting (press)",
          amount: r2(pressCost * mk),
          note: `${hits.toLocaleString("en-US")} hits`,
        });
      }
    } else {
      const l = legacyLine();
      if (l) {
        lines.push(l);
        method = "legacy";
      }
    }

    if (lamOn(s) && geom.glue_lines > 0 && qty > 0) {
      const lam = s.lam_setup_usd + qty * geom.glue_lines * s.lam_per_glue_line_usd;
      lines.push({
        key: "lamination",
        label: `Lamination (${geom.glue_lines} glue line${geom.glue_lines > 1 ? "s" : ""} per part)`,
        amount: r2(lam * mk),
        note: geom.sheets ? `${geom.sheets.length} sheet${geom.sheets.length === 1 ? "" : "s"} per part` : null,
      });
    }
  }

  return {
    model: args.model,
    method,
    lines,
    total: r2(lines.reduce((sum, l) => sum + l.amount, 0)),
    detail,
  };
}
