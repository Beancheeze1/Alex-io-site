// lib/display-assembly.ts
//
// Step 39D: assembly and packing for displays and other multi-part jobs.
// Pure (no DB); tested in scripts/test-display-assembly.ts.
//
// Each shop sets how it costs this (lib/corrugated-blank.ts DISPLAY_KEYS);
// every field is optional and 0 = not used, so a shop that prices per
// display, per part or by time fills in only what it uses. Per display:
//   cost = asm per display
//        + asm per part x parts
//        + labor $/hr x (min per display + min per part x parts) / 60
//        + kitting / packing per display
// Staff can override one quote: minutes per display (replaces the labor
// minutes) and / or $ per display (replaces the whole cost). The shop's
// markup is applied, like every other corrugated cost.
// The charge sits on the quote as its own line (quote_box_selections,
// custom_style "assembly", qty = displays), so every total includes it.

export type AssemblyRates = {
  asm_per_display_usd: number;
  asm_per_part_usd: number;
  labor_per_hr_usd: number;
  labor_min_per_display: number;
  labor_min_per_part: number;
  kit_per_display_usd: number;
  markup_pct: number;
};

export type AssemblyOverride = { minutes_per_display?: number | null; usd_per_display?: number | null };

export type AssemblyResult = {
  displays: number;
  parts_per_display: number;
  minutes_per_display: number; // labor minutes used (shop or override)
  cost_per_display: number; // before markup
  unit_usd: number; // per display, marked up (4 decimals)
  total_usd: number; // all displays, cents
  overridden: boolean;
  set_up: boolean; // the shop has at least one assembly / packing rate, or an override
  breakdown: { label: string; per_display: number }[];
};

export const ASSEMBLY_STYLE = "assembly";

const n0 = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function assemblyRatesFrom(s: Record<string, unknown>): AssemblyRates {
  return {
    asm_per_display_usd: n0(s.asm_per_display_usd),
    asm_per_part_usd: n0(s.asm_per_part_usd),
    labor_per_hr_usd: n0(s.labor_per_hr_usd),
    labor_min_per_display: n0(s.labor_min_per_display),
    labor_min_per_part: n0(s.labor_min_per_part),
    kit_per_display_usd: n0(s.kit_per_display_usd),
    markup_pct: n0(s.markup_pct),
  };
}

/** A stored override (the assembly line's dieline jsonb) -> clean numbers, or {}. */
export function parseAssemblyOverride(raw: unknown): AssemblyOverride {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const pick = (k: string) => {
    if (o[k] === null || o[k] === undefined || o[k] === "") return null;
    const x = Number(o[k]);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  return { minutes_per_display: pick("minutes_per_display"), usd_per_display: pick("usd_per_display") };
}

export function priceAssembly(args: {
  rates: AssemblyRates;
  displays: number;
  partsPerDisplay: number;
  override?: AssemblyOverride | null;
}): AssemblyResult {
  const r = args.rates;
  const displays = Math.max(0, Math.round(Number(args.displays) || 0));
  const parts = Math.max(0, Math.round(Number(args.partsPerDisplay) || 0));
  const ov = args.override || {};
  const minOverride = ov.minutes_per_display != null && Number.isFinite(ov.minutes_per_display);
  const usdOverride = ov.usd_per_display != null && Number.isFinite(ov.usd_per_display);
  const minutes = minOverride ? Number(ov.minutes_per_display) : r.labor_min_per_display + r.labor_min_per_part * parts;
  const breakdown: { label: string; per_display: number }[] = [];
  let cost: number;
  if (usdOverride) {
    cost = Number(ov.usd_per_display);
    breakdown.push({ label: "Set on this quote", per_display: r4(cost) });
  } else {
    const items: [string, number][] = [
      ["Assembly per display", r.asm_per_display_usd],
      [`Assembly per part (${parts})`, r.asm_per_part_usd * parts],
      [`Labor (${r4(minutes)} min)`, (r.labor_per_hr_usd * minutes) / 60],
      ["Kitting / packing", r.kit_per_display_usd],
    ];
    for (const [label, v] of items) if (v > 0) breakdown.push({ label, per_display: r4(v) });
    cost = items.reduce((s, [, v]) => s + v, 0);
  }
  const mk = 1 + r.markup_pct / 100;
  const unit = r4(cost * mk);
  const setUp =
    usdOverride ||
    minOverride ||
    r.asm_per_display_usd > 0 ||
    r.asm_per_part_usd > 0 ||
    r.kit_per_display_usd > 0 ||
    (r.labor_per_hr_usd > 0 && (r.labor_min_per_display > 0 || r.labor_min_per_part > 0));
  return {
    displays,
    parts_per_display: parts,
    minutes_per_display: r4(minutes),
    cost_per_display: r4(cost),
    unit_usd: unit,
    total_usd: r2(unit * displays),
    overridden: usdOverride || minOverride,
    set_up: setUp,
    breakdown,
  };
}

export function assemblyDescription(a: Pick<AssemblyResult, "displays" | "parts_per_display">): string {
  return `Assembly and packing: ${a.displays.toLocaleString("en-US")} display${a.displays === 1 ? "" : "s"}, ${a.parts_per_display} part${a.parts_per_display === 1 ? "" : "s"} each`;
}

/** Parts per display for a die line part line (stored on its dieline jsonb), default 1. */
export function perDisplayOf(dieline: unknown): number {
  const v = Number((dieline as { per_display?: unknown } | null)?.per_display);
  return Number.isInteger(v) && v >= 1 && v <= 10000 ? v : 1;
}

/**
 * Step 39D2: the note under the one-time cutting die line on the quote.
 * Boxes read "Steel-rule die to cut the 12 × 10 × 8 in rsc and the …" (as
 * before); die line parts are listed by name, e.g. "Steel-rule dies for 5
 * parts: Shipper (46.125 × 18.375 in blank); Back (30 × 40 in blank); …".
 */
export function cuttingDieNote(items: { part: boolean; text: string }[]): string | null {
  const list = items.filter((x) => x.text.trim());
  if (!list.length) return null;
  const parts = list.filter((x) => x.part).map((x) => x.text);
  const boxes = list.filter((x) => !x.part).map((x) => x.text);
  if (!parts.length) return `Steel-rule die to cut the ${boxes.join(" and the ")}. Charged once, not per box.`;
  const partText = parts.length === 1 ? `the part: ${parts[0]}` : `${parts.length} parts: ${parts.join("; ")}`;
  if (!boxes.length) return `Steel-rule dies for ${partText}. Charged once, not per part.`;
  return `Steel-rule dies for the ${boxes.join(" and the ")}, and for ${partText}. Charged once.`;
}
