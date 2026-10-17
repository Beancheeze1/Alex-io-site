// app/lib/freight-core.ts
//
// Step 30: freight estimate from a weight / zone table (no carrier accounts).
// Pure (no DB, no network) so scripts/test-freight.ts can check it.
//
//   1. Load: foam pieces (block L x W x H, qty, density) and boxes (inside
//      L x W x H, qty, flute + caliper) -> weight and shipping volume.
//      Foam: block volume x density (cavities not subtracted: a little heavy
//      on purpose); packed in the shop's standard carton at its fill %.
//      Boxes ship flat: approximate blank area by style (RSC ~ (2L + 2W +
//      1.5) x (W + H)), x caliper for volume, x board weight per sq ft by
//      flute. Step 37K: flat boxes are bundled straight onto the pallet, not
//      packed into cartons (for parcel they count as carton-sized bundles).
//   2. Zone: straight-line miles between the 3-digit ZIP centres of the
//      shop and the ship-to, into the shop's 7 distance bands.
//   3. Parcel when the shipment fits the shop's parcel limits (billable
//      weight = max(actual, dimensional)): $/lb by zone + $ per carton.
//      Otherwise LTL: pallets (by volume and weight) x $/pallet by zone, at
//      least the LTL minimum.
//   4. Markup %, free freight over $X (prepaid & add only), staff override.
// Terms: prepaid_add (freight on the quote, in the total), fob_origin (buyer
// pays the carrier: shown for information, not in the total), pickup (none).

import { zip3Point } from "./zip3";

export type FreightTerms = "prepaid_add" | "fob_origin" | "pickup";
export const FREIGHT_TERMS: readonly FreightTerms[] = ["prepaid_add", "fob_origin", "pickup"];
export const TERMS_LABEL: Record<FreightTerms, string> = {
  prepaid_add: "Prepaid & add (we ship, freight on this quote)",
  fob_origin: "FOB origin / collect (you pay the carrier)",
  pickup: "Customer pickup",
};

export function isFreightTerms(v: unknown): v is FreightTerms {
  return typeof v === "string" && (FREIGHT_TERMS as readonly string[]).includes(v);
}

export const ZONES = 7;

export type FreightSettings = {
  ship_from_zip: string; // "" = freight not set up (the old rough % estimate is used)
  default_terms: FreightTerms;
  terms_allowed: FreightTerms[];
  free_over_usd: number; // 0 = off
  markup_pct: number;
  zone_miles: number[]; // 6 upper limits; zone 7 is everything beyond
  parcel_per_lb: number[]; // 7
  parcel_per_carton_usd: number;
  parcel_max_lb: number; // whole shipment, billable
  parcel_max_cartons: number;
  ltl_per_pallet: number[]; // 7
  ltl_min_usd: number;
  carton_l_in: number;
  carton_w_in: number;
  carton_h_in: number;
  carton_fill_pct: number;
  carton_weight_lb: number;
  dim_divisor: number;
  pallet_l_in: number;
  pallet_w_in: number;
  pallet_max_h_in: number;
  pallet_weight_lb: number;
  pallet_max_lb: number;
};

export const FREIGHT_DEFAULTS: FreightSettings = {
  ship_from_zip: "",
  default_terms: "prepaid_add",
  terms_allowed: ["prepaid_add", "fob_origin", "pickup"],
  free_over_usd: 0,
  markup_pct: 0,
  zone_miles: [150, 300, 600, 1000, 1400, 1800],
  parcel_per_lb: [0.55, 0.65, 0.8, 0.95, 1.1, 1.25, 1.45],
  parcel_per_carton_usd: 9,
  parcel_max_lb: 150,
  parcel_max_cartons: 10,
  ltl_per_pallet: [175, 225, 300, 375, 450, 525, 650],
  ltl_min_usd: 200,
  carton_l_in: 24,
  carton_w_in: 18,
  carton_h_in: 18,
  carton_fill_pct: 85,
  carton_weight_lb: 2,
  dim_divisor: 139,
  pallet_l_in: 48,
  pallet_w_in: 40,
  pallet_max_h_in: 60,
  pallet_weight_lb: 40,
  pallet_max_lb: 1500,
};

/** Board weight (lb per sq ft) and caliper (in) by flute, when the shop's flute table has none. */
const FLUTE_LB_SQFT: Record<string, number> = { F: 0.07, E: 0.085, B: 0.1, C: 0.12, EB: 0.185, BC: 0.21 };
const FLUTE_CALIPER_IN: Record<string, number> = { F: 0.03, E: 0.0625, B: 0.125, C: 0.16, EB: 0.19, BC: 0.28 };

export function fluteLbPerSqft(flute: string | null | undefined): number {
  return FLUTE_LB_SQFT[String(flute || "C").toUpperCase()] ?? FLUTE_LB_SQFT.C;
}
export function fluteCaliperIn(flute: string | null | undefined): number {
  return FLUTE_CALIPER_IN[String(flute || "C").toUpperCase()] ?? FLUTE_CALIPER_IN.C;
}

export function cleanZip(v: unknown): string | null {
  const m = /^\s*(\d{5})(?:-?(\d{4}))?\s*$/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

const num = (v: unknown, d: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

/** Settings as stored (fills gaps from the defaults); throws a message for a bad value on save. */
export function cleanFreightSettings(raw: unknown, strict = false): FreightSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const D = FREIGHT_DEFAULTS;
  const fail = (msg: string) => {
    if (strict) throw new Error(msg);
  };
  const n = (k: keyof FreightSettings, min: number, max: number, label: string): number => {
    if (r[k] === undefined || r[k] === null || r[k] === "") return D[k] as number;
    const v = Number(r[k]);
    if (!Number.isFinite(v) || v < min || v > max) fail(`${label} must be from ${min} to ${max}.`);
    return num(r[k], D[k] as number, min, max);
  };
  const arr = (k: "parcel_per_lb" | "ltl_per_pallet" | "zone_miles", len: number, max: number, label: string): number[] => {
    const a = Array.isArray(r[k]) ? (r[k] as unknown[]) : null;
    if (!a) return [...(D[k] as number[])];
    if (a.length !== len) fail(`${label} needs ${len} values.`);
    return Array.from({ length: len }, (_, i) => {
      const v = Number(a[i]);
      if (!Number.isFinite(v) || v < 0 || v > max) fail(`${label}: each value must be from 0 to ${max}.`);
      return num(a[i], (D[k] as number[])[i], 0, max);
    });
  };

  let zip = "";
  if (r.ship_from_zip !== undefined && r.ship_from_zip !== null && String(r.ship_from_zip).trim() !== "") {
    const z = cleanZip(r.ship_from_zip);
    if (!z || !zip3Point(z)) fail("Ship-from ZIP must be a US ZIP code.");
    zip = z && zip3Point(z) ? z : "";
  }
  const allowed = Array.isArray(r.terms_allowed)
    ? (r.terms_allowed as unknown[]).filter(isFreightTerms)
    : [...D.terms_allowed];
  if (Array.isArray(r.terms_allowed) && allowed.length === 0) fail("Allow at least one freight term.");
  const termsAllowed = allowed.length ? Array.from(new Set(allowed)) : [...D.terms_allowed];
  let defTerms = isFreightTerms(r.default_terms) ? r.default_terms : D.default_terms;
  if (!termsAllowed.includes(defTerms)) {
    if (r.default_terms !== undefined) fail("The default freight term must be one of the allowed terms.");
    defTerms = termsAllowed[0];
  }
  const zoneMiles = arr("zone_miles", ZONES - 1, 10000, "Zone miles");
  for (let i = 1; i < zoneMiles.length; i++) {
    if (zoneMiles[i] <= zoneMiles[i - 1]) fail("Zone miles must go up from zone 1 to zone 6.");
  }

  return {
    ship_from_zip: zip,
    default_terms: defTerms,
    terms_allowed: termsAllowed,
    free_over_usd: n("free_over_usd", 0, 10_000_000, "Free freight over"),
    markup_pct: n("markup_pct", 0, 500, "Freight markup %"),
    zone_miles: zoneMiles,
    parcel_per_lb: arr("parcel_per_lb", ZONES, 100, "Parcel $/lb"),
    parcel_per_carton_usd: n("parcel_per_carton_usd", 0, 1000, "Parcel $ per carton"),
    parcel_max_lb: n("parcel_max_lb", 0, 5000, "Parcel max lb"),
    parcel_max_cartons: n("parcel_max_cartons", 0, 500, "Parcel max cartons"),
    ltl_per_pallet: arr("ltl_per_pallet", ZONES, 100000, "LTL $/pallet"),
    ltl_min_usd: n("ltl_min_usd", 0, 100000, "LTL minimum"),
    carton_l_in: n("carton_l_in", 4, 120, "Carton length"),
    carton_w_in: n("carton_w_in", 4, 120, "Carton width"),
    carton_h_in: n("carton_h_in", 4, 120, "Carton height"),
    carton_fill_pct: n("carton_fill_pct", 10, 100, "Carton fill %"),
    carton_weight_lb: n("carton_weight_lb", 0, 100, "Carton weight"),
    dim_divisor: n("dim_divisor", 50, 500, "Dim divisor"),
    pallet_l_in: n("pallet_l_in", 20, 120, "Pallet length"),
    pallet_w_in: n("pallet_w_in", 20, 120, "Pallet width"),
    pallet_max_h_in: n("pallet_max_h_in", 12, 120, "Pallet max height"),
    pallet_weight_lb: n("pallet_weight_lb", 0, 500, "Pallet weight"),
    pallet_max_lb: n("pallet_max_lb", 50, 10000, "Pallet max weight"),
  };
}

export function milesBetweenZips(a: string | null | undefined, b: string | null | undefined): number | null {
  const p = zip3Point(a);
  const q = zip3Point(b);
  if (!p || !q) return null;
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(q[0] - p[0]);
  const dLon = rad(q[1] - p[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Zone 1..7 for a distance, by the shop's 6 upper limits. */
export function zoneFor(miles: number, zoneMiles: number[]): number {
  for (let i = 0; i < zoneMiles.length; i++) if (miles <= zoneMiles[i]) return i + 1;
  return ZONES;
}

export type FoamPiece = { l: number; w: number; h: number; qty: number; density_pcf: number | null };
export type BoxPiece = {
  l: number;
  w: number;
  h: number;
  qty: number;
  style?: string | null;
  flute?: string | null;
  caliper_in?: number | null;
};

/** Approximate flat blank area (sq in) of one box by style. */
export function blankAreaIn2(b: Pick<BoxPiece, "l" | "w" | "h" | "style">): number {
  const h = b.h > 0 ? b.h : 0;
  const style = String(b.style || "rsc").toLowerCase();
  if (style === "pad") return b.l * b.w;
  if (style === "tray") return (b.l + 2 * h) * (b.w + 2 * h);
  if (style === "fol") return (2 * b.l + 2 * b.w + 1.5) * (h + 2 * b.w);
  if (style === "mailer") return (b.l + 4 * h) * (2 * b.w + 3 * h);
  if (style === "hsc") return (2 * b.l + 2 * b.w + 1.5) * (h + b.w / 2);
  return (2 * b.l + 2 * b.w + 1.5) * (h + b.w); // rsc and anything else
}

export type PackResult = {
  foam_lb: number;
  box_lb: number;
  cartons: number; // foam cartons only (Step 37K)
  bundles: number; // Step 37K: flat-box bundles, carton-sized, no carton
  actual_lb: number; // product + cartons
  volume_in3: number; // cartons + flat board
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function packLoad(foam: FoamPiece[], boxes: BoxPiece[], s: FreightSettings): PackResult {
  const cartonVol = s.carton_l_in * s.carton_w_in * s.carton_h_in;
  const fill = s.carton_fill_pct / 100;
  let foamVol = 0;
  let foamLb = 0;
  for (const p of foam) {
    if (!(p.l > 0 && p.w > 0 && p.h > 0 && p.qty > 0)) continue;
    const v = p.l * p.w * p.h * p.qty;
    foamVol += v;
    foamLb += (v / 1728) * (p.density_pcf && p.density_pcf > 0 ? p.density_pcf : 1.7);
  }
  let boxVol = 0;
  let boxLb = 0;
  for (const b of boxes) {
    if (!(b.l > 0 && b.w > 0 && b.qty > 0)) continue;
    const areaIn2 = blankAreaIn2(b);
    const caliper = b.caliper_in && b.caliper_in > 0 ? b.caliper_in : fluteCaliperIn(b.flute);
    boxVol += areaIn2 * caliper * b.qty;
    boxLb += (areaIn2 / 144) * fluteLbPerSqft(b.flute) * b.qty;
  }
  const foamCartons = foamVol > 0 ? Math.ceil(foamVol / (cartonVol * fill)) : 0;
  // Step 37K: boxes ship as flat bundles, no shipping carton around them.
  // The bundle count (carton-sized) only matters for the parcel limits.
  const bundles = boxVol > 0 ? Math.ceil(boxVol / (cartonVol * 0.9)) : 0;
  return {
    foam_lb: r1(foamLb),
    box_lb: r1(boxLb),
    cartons: foamCartons,
    bundles,
    actual_lb: r1(foamLb + boxLb + foamCartons * s.carton_weight_lb),
    volume_in3: foamCartons * cartonVol + boxVol,
  };
}

export type FreightStatus =
  | "pickup" // no freight
  | "not_set_up" // the shop has no ship-from ZIP: old rough estimate
  | "needs_zip" // no (valid) ship-to ZIP yet
  | "nothing_to_ship"
  | "estimated" // worked out from the table
  | "free" // prepaid & add over the shop's free-freight amount
  | "override"; // staff typed the freight

export type FreightResult = {
  status: FreightStatus;
  terms: FreightTerms;
  in_total: boolean; // added to the quote total (prepaid & add)
  cost: number; // what the quote charges (0 unless in_total)
  estimate: number | null; // the worked-out freight (for collect: what the carrier may charge)
  mode: "parcel" | "ltl" | null;
  zone: number | null;
  miles: number | null;
  cartons: number;
  pallets: number;
  actual_lb: number;
  billable_lb: number;
  note: string;
  locked?: boolean; // Step 30B: kept from when the quote was accepted / confirmed
};

/**
 * Step 30B: what a saved freight depends on besides the shop's freight table:
 * terms, ship-to ZIP, staff override, and the quote's other charges (to the
 * cent; a change to the items or prices changes it).
 */
export function freightLockKey(terms: FreightTerms, zip: string | null | undefined, overrideUsd: number | null | undefined, subtotal: number): string {
  return [terms, cleanZip(zip) || "", overrideUsd == null ? "" : Math.round(Number(overrideUsd) * 100), Math.round((Number(subtotal) || 0) * 100)].join("|");
}

/** Freight results worth keeping (pickup / not set up / no ZIP aren't). */
export function lockableFreight(f: FreightResult | null | undefined): boolean {
  return !!f && (f.status === "estimated" || f.status === "free" || f.status === "override");
}

export function estimateFreight(args: {
  s: FreightSettings;
  terms: FreightTerms;
  toZip: string | null | undefined;
  foam: FoamPiece[];
  boxes: BoxPiece[];
  subtotal: number;
  overrideUsd?: number | null;
}): FreightResult {
  const { s, terms } = args;
  const base: FreightResult = {
    status: "pickup",
    terms,
    in_total: false,
    cost: 0,
    estimate: null,
    mode: null,
    zone: null,
    miles: null,
    cartons: 0,
    pallets: 0,
    actual_lb: 0,
    billable_lb: 0,
    note: "",
  };
  if (terms === "pickup") return { ...base, note: "Customer pickup at the shop: no freight." };

  const override = args.overrideUsd != null && Number.isFinite(Number(args.overrideUsd)) && Number(args.overrideUsd) >= 0
    ? r2(Number(args.overrideUsd))
    : null;
  if (override != null) {
    const prepaid = terms === "prepaid_add";
    return {
      ...base,
      status: "override",
      in_total: prepaid,
      cost: prepaid ? override : 0,
      estimate: override,
      note: prepaid ? "Freight set by the shop." : "Freight estimate from the shop (you pay the carrier).",
    };
  }
  if (!s.ship_from_zip) return { ...base, status: "not_set_up", note: "" };
  const to = cleanZip(args.toZip);
  const miles = to ? milesBetweenZips(s.ship_from_zip, to) : null;
  if (!to || miles == null) return { ...base, status: "needs_zip", note: "Add a ship-to ZIP to see freight." };

  const pack = packLoad(args.foam, args.boxes, s);
  const pieces = pack.cartons + pack.bundles; // Step 37K
  if (pieces === 0) return { ...base, status: "nothing_to_ship", miles, note: "Nothing to ship yet." };

  const zone = zoneFor(miles, s.zone_miles);
  const dimLb = pack.volume_in3 / s.dim_divisor;
  const billable = Math.ceil(Math.max(pack.actual_lb, dimLb));
  let mode: "parcel" | "ltl";
  let cost: number;
  let pallets = 0;
  let actual = pack.actual_lb;
  if (pieces <= s.parcel_max_cartons && billable <= s.parcel_max_lb) {
    mode = "parcel";
    cost = billable * s.parcel_per_lb[zone - 1] + pieces * s.parcel_per_carton_usd;
  } else {
    mode = "ltl";
    const palletVol = s.pallet_l_in * s.pallet_w_in * s.pallet_max_h_in * 0.85;
    pallets = Math.max(1, Math.ceil(pack.volume_in3 / palletVol), Math.ceil(pack.actual_lb / s.pallet_max_lb));
    actual = r1(pack.actual_lb + pallets * s.pallet_weight_lb);
    cost = Math.max(pallets * s.ltl_per_pallet[zone - 1], s.ltl_min_usd);
  }
  const estimate = r2(cost * (1 + s.markup_pct / 100));
  const prepaid = terms === "prepaid_add";
  const free = prepaid && s.free_over_usd > 0 && args.subtotal >= s.free_over_usd;
  const what =
    mode === "parcel"
      ? `${[
          pack.cartons ? `${pack.cartons} carton${pack.cartons === 1 ? "" : "s"}` : "",
          pack.bundles ? `${pack.bundles} bundle${pack.bundles === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" + ")}, ${billable} lb billable, zone ${zone} (~${miles} mi)`
      : `${pallets} pallet${pallets === 1 ? "" : "s"} LTL, ${Math.round(actual)} lb, zone ${zone} (~${miles} mi)`;
  return {
    ...base,
    status: free ? "free" : "estimated",
    in_total: prepaid,
    cost: prepaid && !free ? estimate : 0,
    estimate,
    mode,
    zone,
    miles,
    cartons: pack.cartons,
    pallets,
    actual_lb: actual,
    billable_lb: mode === "parcel" ? billable : Math.round(actual),
    note: free
      ? `Free freight (orders over $${s.free_over_usd.toLocaleString("en-US")}). ${what}.`
      : prepaid
        ? `Estimated freight: ${what}.`
        : `You pay the carrier. Estimate: ${what}.`,
  };
}
