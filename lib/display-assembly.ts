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
// Step 39Y: the shop's minimum order applies once to the whole display
// (parts + their plates and dies + assembly), not to each part: parts are
// priced without it, and any shortfall is added to this line
// (min_topup_usd, said in its description).
// Step 49: per-part assembly. Each shop keeps a list of assembly methods
// (corrugated_settings.asm_methods: name, minutes per piece, materials $ per
// piece, one default). Each part can pick a method and/or its own minutes
// (stored on the part's dieline blob as asm: { method, minutes }); a part
// with neither uses the default method, else the shop's minutes per part, so
// a display with no methods prices exactly as before. A display can ship
// knocked down (flat; override.knocked_down): then the parts' assembly
// (their minutes, materials and $ per part) and $ per display drop out, and
// only the per-display minutes (pack-out) and kitting are charged.

export type AssemblyRates = {
  asm_per_display_usd: number;
  asm_per_part_usd: number;
  labor_per_hr_usd: number;
  labor_min_per_display: number;
  labor_min_per_part: number;
  kit_per_display_usd: number;
  markup_pct: number;
};

export type AssemblyOverride = {
  minutes_per_display?: number | null;
  usd_per_display?: number | null;
  knocked_down?: boolean; // Step 49: ships flat, the customer assembles
};

/** Step 49: one of the shop's assembly methods. */
export type AssemblyMethod = {
  id: string; // short stable key, e.g. "tape"
  name: string;
  minutes: number; // labor minutes per piece
  materials_usd: number; // tape, glue, staples ... per piece
  is_default: boolean;
};

/** Step 49: a part's own assembly choice (null = the shop's default). */
export type PartAsm = { method: string | null; minutes: number | null };

/** Step 49: a display part as the assembly price needs it. */
export type AssemblyPart = { label: string; count: number; asm: PartAsm };

/** Step 49: how one part's assembly was priced (shown on the Display card). */
export type AssemblyPartDetail = {
  label: string;
  count: number;
  method: string | null; // the method's name, null = none / shop minutes per part
  minutes_each: number;
  materials_each: number;
  own_minutes: boolean; // minutes typed on the part
};

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
  min_topup_usd?: number; // Step 39Y: added to reach the shop's minimum order (whole display)
  min_order_usd?: number; // Step 39Y: the minimum it was raised to
  knocked_down?: boolean; // Step 49
  parts?: AssemblyPartDetail[]; // Step 49: per part, when parts were given
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
  return {
    minutes_per_display: pick("minutes_per_display"),
    usd_per_display: pick("usd_per_display"),
    ...(o.knocked_down === true ? { knocked_down: true } : {}), // Step 49 (only when true, so old blobs read the same)
  };
}

// ---------- Step 49: assembly methods ----------

/** Starting list a shop can load and edit (placeholders: each shop sets its own). */
export const TYPICAL_ASSEMBLY_METHODS: AssemblyMethod[] = [
  { id: "fold", name: "Fold / lock-tab", minutes: 0.5, materials_usd: 0, is_default: true },
  { id: "tape", name: "Double-sided tape", minutes: 1.5, materials_usd: 0.08, is_default: false },
  { id: "hotmelt", name: "Hot melt glue", minutes: 1, materials_usd: 0.04, is_default: false },
  { id: "glue", name: "Cold glue", minutes: 1.5, materials_usd: 0.03, is_default: false },
  { id: "staple", name: "Staple", minutes: 0.5, materials_usd: 0.01, is_default: false },
  { id: "none", name: "None (loose / ships flat)", minutes: 0, materials_usd: 0, is_default: false },
];

const MAX_METHODS = 20;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

/**
 * Step 49: a shop's method list from settings (or a PUT body). Bad rows are
 * an error with a message; ids are kept when given, else made from the name.
 * At most one default (the first marked wins when several are).
 */
export function cleanAssemblyMethods(raw: unknown): { ok: true; methods: AssemblyMethod[] } | { ok: false; message: string } {
  if (raw == null) return { ok: true, methods: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "Assembly methods must be a list." };
  if (raw.length > MAX_METHODS) return { ok: false, message: `List up to ${MAX_METHODS} assembly methods.` };
  const out: AssemblyMethod[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const name = String(o.name ?? "").trim().slice(0, 40);
    if (!name) return { ok: false, message: "Every assembly method needs a name." };
    if (names.has(name.toLowerCase())) return { ok: false, message: `Assembly method "${name}" is listed twice.` };
    names.add(name.toLowerCase());
    const minutes = Number(o.minutes);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 600) {
      return { ok: false, message: `Assembly method "${name}": minutes per piece must be a number from 0 to 600.` };
    }
    const mat = o.materials_usd === "" || o.materials_usd == null ? 0 : Number(o.materials_usd);
    if (!Number.isFinite(mat) || mat < 0 || mat > 1000) {
      return { ok: false, message: `Assembly method "${name}": materials per piece must be a number from 0 to 1000.` };
    }
    let id = typeof o.id === "string" && /^[a-z0-9-]{1,24}$/.test(o.id) ? o.id : slug(name) || "method";
    let k = 2;
    const base = id;
    while (ids.has(id)) id = `${base.slice(0, 20)}-${k++}`;
    ids.add(id);
    out.push({ id, name, minutes: r4(minutes), materials_usd: r4(mat), is_default: o.is_default === true });
  }
  let seen = false;
  for (const m of out) {
    if (m.is_default && !seen) seen = true;
    else m.is_default = false;
  }
  return { ok: true, methods: out };
}

/** Step 49: a part's stored assembly choice (dieline blob .asm), cleaned. */
export function partAsmOf(dieline: unknown): PartAsm {
  const a = (dieline as { asm?: unknown } | null)?.asm;
  const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const method = typeof o.method === "string" && /^[a-z0-9-]{1,24}$/.test(o.method) ? o.method : null;
  const m = o.minutes === null || o.minutes === undefined || o.minutes === "" ? NaN : Number(o.minutes);
  return { method, minutes: Number.isFinite(m) && m >= 0 && m <= 600 ? r4(m) : null };
}

/** Step 49: a part assembly choice from a request (null = clear); undefined = bad input. */
export function cleanPartAsm(raw: unknown): PartAsm | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const method = o.method === null || o.method === undefined || o.method === "" ? null : o.method;
  if (method !== null && (typeof method !== "string" || !/^[a-z0-9-]{1,24}$/.test(method))) return undefined;
  const mRaw = o.minutes;
  let minutes: number | null = null;
  if (!(mRaw === null || mRaw === undefined || mRaw === "")) {
    const m = Number(mRaw);
    if (!Number.isFinite(m) || m < 0 || m > 600) return undefined;
    minutes = r4(m);
  }
  if (method === null && minutes === null) return null;
  return { method: method as string | null, minutes };
}

export function priceAssembly(args: {
  rates: AssemblyRates;
  displays: number;
  partsPerDisplay: number;
  override?: AssemblyOverride | null;
  parts?: AssemblyPart[] | null; // Step 49: each part's count + assembly choice
  methods?: AssemblyMethod[] | null; // Step 49: the shop's methods
}): AssemblyResult {
  const r = args.rates;
  const displays = Math.max(0, Math.round(Number(args.displays) || 0));
  const ov = args.override || {};
  const kd = ov.knocked_down === true; // Step 49
  const methods = Array.isArray(args.methods) ? args.methods : [];
  const byId = new Map(methods.map((m) => [m.id, m]));
  const dflt = methods.find((m) => m.is_default) ?? null;
  // Step 49: each part's minutes and materials (own minutes > its method > default method > shop minutes per part)
  const details: AssemblyPartDetail[] | undefined = Array.isArray(args.parts)
    ? args.parts.map((p) => {
        const count = Math.max(0, Math.round(Number(p.count) || 0));
        const m = (p.asm.method ? byId.get(p.asm.method) : undefined) ?? dflt;
        const own = p.asm.minutes != null && Number.isFinite(p.asm.minutes);
        return {
          label: p.label,
          count,
          method: m ? m.name : null,
          minutes_each: r4(own ? Number(p.asm.minutes) : m ? m.minutes : r.labor_min_per_part),
          materials_each: r4(m ? m.materials_usd : 0),
          own_minutes: own,
        };
      })
    : undefined;
  const parts = details
    ? details.reduce((n, d) => n + d.count, 0)
    : Math.max(0, Math.round(Number(args.partsPerDisplay) || 0));
  const partMinutes = details ? details.reduce((n, d) => n + d.count * d.minutes_each, 0) : r.labor_min_per_part * parts;
  const materials = details ? details.reduce((n, d) => n + d.count * d.materials_each, 0) : 0;
  const minOverride = ov.minutes_per_display != null && Number.isFinite(ov.minutes_per_display);
  const usdOverride = ov.usd_per_display != null && Number.isFinite(ov.usd_per_display);
  const minutes = minOverride ? Number(ov.minutes_per_display) : r.labor_min_per_display + (kd ? 0 : partMinutes);
  const breakdown: { label: string; per_display: number }[] = [];
  let cost: number;
  if (usdOverride) {
    cost = Number(ov.usd_per_display);
    breakdown.push({ label: "Set on this quote", per_display: r4(cost) });
  } else {
    const items: [string, number][] = [
      ["Assembly per display", kd ? 0 : r.asm_per_display_usd],
      [`Assembly per part (${parts})`, kd ? 0 : r.asm_per_part_usd * parts],
      [kd ? `Pack-out labor (${r4(minutes)} min)` : `Labor (${r4(minutes)} min)`, (r.labor_per_hr_usd * minutes) / 60],
      ["Tape, glue and other materials", kd ? 0 : materials],
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
    materials > 0 || // Step 49
    (r.labor_per_hr_usd > 0 && (r.labor_min_per_display > 0 || r.labor_min_per_part > 0 || partMinutes > 0));
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
    ...(kd ? { knocked_down: true } : {}), // Step 49
    ...(details ? { parts: details } : {}),
  };
}

export function assemblyDescription(
  a: Pick<AssemblyResult, "displays" | "parts_per_display" | "min_topup_usd" | "min_order_usd" | "knocked_down">,
): string {
  // Step 49: say whether the displays arrive assembled or flat
  const base = a.knocked_down
    ? `Packing: ${a.displays.toLocaleString("en-US")} display${a.displays === 1 ? "" : "s"}, ${a.parts_per_display} part${a.parts_per_display === 1 ? "" : "s"} each, ships knocked down (flat)`
    : `Assembly and packing: ${a.displays.toLocaleString("en-US")} display${a.displays === 1 ? "" : "s"}, ${a.parts_per_display} part${a.parts_per_display === 1 ? "" : "s"} each`;
  return a.min_topup_usd && a.min_topup_usd > 0 && a.min_order_usd
    ? `${base} (includes ${money(a.min_topup_usd)} to reach the ${money(a.min_order_usd)} minimum order)`
    : base;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Step 39Y: the shortfall to the shop's minimum order for a whole display:
 * min - (parts incl. plates and dies + assembly), or 0. No minimum set, or a
 * part without a price (partsUsd null) = 0.
 */
export function displayMinimumTopUp(partsUsd: number | null, assemblyUsd: number, minOrderUsd: unknown): number {
  const min = n0(minOrderUsd);
  if (!min || partsUsd == null || !Number.isFinite(partsUsd)) return 0;
  const total = r2(partsUsd + (Number(assemblyUsd) || 0));
  return total < min ? r2(min - total) : 0;
}

/** Step 39Y: the assembly result with the minimum-order shortfall added (unit = total / displays). */
export function withMinimumTopUp(a: AssemblyResult, topUp: number, minOrderUsd: unknown): AssemblyResult {
  if (!(topUp > 0)) return a;
  const total = r2(a.total_usd + topUp);
  return {
    ...a,
    total_usd: total,
    unit_usd: a.displays > 0 ? r4(total / a.displays) : a.unit_usd,
    min_topup_usd: r2(topUp),
    min_order_usd: n0(minOrderUsd),
  };
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
