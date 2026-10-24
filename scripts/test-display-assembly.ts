// scripts/test-display-assembly.ts
//
// Step 39D: tests for display assembly / packing pricing (lib/display-assembly.ts).
// Run: npm run test:display   (= npx --yes tsx scripts/test-display-assembly.ts)

import {
  assemblyDescription,
  cuttingDieNote,
  assemblyRatesFrom,
  parseAssemblyOverride,
  perDisplayOf,
  priceAssembly,
  displayMinimumTopUp,
  withMinimumTopUp,
} from "../lib/display-assembly";
import { priceRscBox } from "../lib/corrugated-price";
import { DEFAULT_FLUTES } from "../lib/corrugated-blank";
import { parseDielineBlank, partPrintOf } from "../lib/dieline-import";
import { computePrintCharges } from "../app/lib/pricing/print-charges";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  }
}

const none = assemblyRatesFrom({ markup_pct: 30 });
const a0 = priceAssembly({ rates: none, displays: 500, partsPerDisplay: 6 });
check("no rates: $0, not set up", a0.total_usd === 0 && !a0.set_up && a0.breakdown.length === 0, a0);

// per display only (a shop that prices flat): $12 x 1.3 = 15.60 x 500 = 7,800
const flat = priceAssembly({ rates: assemblyRatesFrom({ asm_per_display_usd: 12, markup_pct: 30 }), displays: 500, partsPerDisplay: 6 });
check("flat per display: unit 15.60, total 7,800", flat.unit_usd === 15.6 && flat.total_usd === 7800 && flat.set_up, flat);

// per part: $1.50 x 6 = 9 x 1.3 = 11.70
const pp = priceAssembly({ rates: assemblyRatesFrom({ asm_per_part_usd: 1.5, markup_pct: 30 }), displays: 100, partsPerDisplay: 6 });
check("per part: 6 parts x $1.50 = 11.70 marked up", pp.unit_usd === 11.7 && pp.total_usd === 1170, pp);

// by time: $36/hr x (4 + 2 x 6 = 16 min) / 60 = 9.60 x 1.3 = 12.48
const t = priceAssembly({
  rates: assemblyRatesFrom({ labor_per_hr_usd: 36, labor_min_per_display: 4, labor_min_per_part: 2, markup_pct: 30 }),
  displays: 250,
  partsPerDisplay: 6,
});
check("labor: 16 min at $36/hr = 9.60 -> 12.48", t.minutes_per_display === 16 && t.cost_per_display === 9.6 && t.unit_usd === 12.48, t);
check("labor total 250 x 12.48 = 3,120", t.total_usd === 3120, t);
check("labor rate without minutes is not set up", !priceAssembly({ rates: assemblyRatesFrom({ labor_per_hr_usd: 36 }), displays: 1, partsPerDisplay: 1 }).set_up);

// everything together: 2 + 0.5 x 4 + 30 x (3 + 1 x 4)/60 + 1.25 = 2 + 2 + 3.5 + 1.25 = 8.75, no markup
const all = priceAssembly({
  rates: assemblyRatesFrom({ asm_per_display_usd: 2, asm_per_part_usd: 0.5, labor_per_hr_usd: 30, labor_min_per_display: 3, labor_min_per_part: 1, kit_per_display_usd: 1.25 }),
  displays: 10,
  partsPerDisplay: 4,
});
check("all fields add up: 8.75 per display", all.cost_per_display === 8.75 && all.unit_usd === 8.75 && all.total_usd === 87.5 && all.breakdown.length === 4, all);

// override minutes (replaces labor minutes only)
const om = priceAssembly({
  rates: assemblyRatesFrom({ labor_per_hr_usd: 36, labor_min_per_display: 4, labor_min_per_part: 2, kit_per_display_usd: 1 }),
  displays: 10,
  partsPerDisplay: 6,
  override: { minutes_per_display: 30 },
});
check("override minutes: 30 min x $36/hr = 18 + kitting 1 = 19", om.minutes_per_display === 30 && om.cost_per_display === 19 && om.overridden, om);
// override $ per display (replaces everything)
const ou = priceAssembly({ rates: assemblyRatesFrom({ asm_per_display_usd: 12, markup_pct: 50 }), displays: 10, partsPerDisplay: 6, override: { usd_per_display: 20 } });
check("override $ per display: 20 x 1.5 = 30, set up", ou.unit_usd === 30 && ou.total_usd === 300 && ou.set_up && ou.breakdown[0].label === "Set on this quote", ou);
check("override on a shop with no rates counts as set up", priceAssembly({ rates: none, displays: 5, partsPerDisplay: 2, override: { usd_per_display: 4 } }).set_up);

check("parseAssemblyOverride keeps numbers, drops junk", JSON.stringify(parseAssemblyOverride({ minutes_per_display: "12", usd_per_display: "x" })) === JSON.stringify({ minutes_per_display: 12, usd_per_display: null }));
check("parseAssemblyOverride of nothing = {}", JSON.stringify(parseAssemblyOverride(null)) === "{}");
check("perDisplayOf default 1, keeps 4, refuses 0", perDisplayOf(null) === 1 && perDisplayOf({ per_display: 4 }) === 4 && perDisplayOf({ per_display: 0 }) === 1);
check("description", assemblyDescription({ displays: 500, parts_per_display: 6 }) === "Assembly and packing: 500 displays, 6 parts each", assemblyDescription({ displays: 500, parts_per_display: 6 }));

// Step 39D2: the cutting die note lists parts by name (not "the die-cut part from your file" x 5)
check("die note: boxes keep the old wording", cuttingDieNote([{ part: false, text: "12 × 10 × 8 in rsc" }]) === "Steel-rule die to cut the 12 × 10 × 8 in rsc. Charged once, not per box.");
const dn = cuttingDieNote([
  { part: true, text: "Shipper (46.125 × 18.375 in blank)" },
  { part: true, text: "Back (30 × 40 in blank)" },
  { part: true, text: "Shelf (20 × 10 in blank)" },
]);
check("die note: parts by name", dn === "Steel-rule dies for 3 parts: Shipper (46.125 × 18.375 in blank); Back (30 × 40 in blank); Shelf (20 × 10 in blank). Charged once, not per part.", dn);
check("die note: one part", cuttingDieNote([{ part: true, text: "20 × 10 in blank" }]) === "Steel-rule dies for the part: 20 × 10 in blank. Charged once, not per part.");
const mixed = cuttingDieNote([{ part: false, text: "12 × 10 × 8 in rsc" }, { part: true, text: "Header (30 × 12 in blank)" }]) ?? "";
check("die note: boxes and parts", mixed.startsWith("Steel-rule dies for the 12 × 10 × 8 in rsc, and for the part: Header"), mixed);
check("die note: none", cuttingDieNote([]) === null);
check("die note: never repeats the style label", !/die-cut part from your file/.test(dn ?? ""));

// Step 39G: a display part's own printing
check("partPrintOf: none -> null", partPrintOf({ length_in: 1 }) === null && partPrintOf(null) === null);
check("partPrintOf: 2 colors outside+inside", JSON.stringify(partPrintOf({ print: { colors: ["spot", "flood"], sides: 2 } })) === JSON.stringify({ colors: ["spot", "flood"], sides: 2 }));
check("partPrintOf: no print is a choice too", JSON.stringify(partPrintOf({ print: { colors: [], sides: 1 } })) === JSON.stringify({ colors: [], sides: 1 }));
check("partPrintOf: junk colors -> null", partPrintOf({ print: { colors: ["neon"], sides: 1 } }) === null);
check("partPrintOf: 5 colors capped at 4 -> null (not silently trimmed)", partPrintOf({ print: { colors: ["spot", "spot", "spot", "spot", "spot"], sides: 1 } }) === null);
const blankPr = parseDielineBlank({ length_in: 10, width_in: 8, cut_in: 36, crease_in: 10, perf_in: 0, rule_in: 46, print: { colors: ["flood"], sides: 1 } });
check("stored part keeps its own printing", !!blankPr && JSON.stringify(blankPr.print) === JSON.stringify({ colors: ["flood"], sides: 1 }), blankPr);
const settings0 = { printing_upcharge_usd: 0, printing_upcharge_pct: 0 };
const perPart = computePrintCharges({ facts: { print_spec: { colors: [], sides: 1 }, part_print: true, printed: 1 }, settings: settings0, foamSubtotal: 0, packagingSubtotal: 100, platesTotal: 202.5 });
check("print charges: parts printed differently, quote unprinted -> printed, per-part summary, plates kept", perPart.isPrinted && perPart.platesTotal === 202.5 && /per part/.test(perPart.printSummary ?? ""), perPart);
const same = computePrintCharges({ facts: { print_spec: { colors: ["spot"], sides: 1 } }, settings: settings0, foamSubtotal: 0, packagingSubtotal: 100, platesTotal: 202.5 });
check("print charges: one printing for the quote unchanged", same.isPrinted && !/per part/.test(same.printSummary ?? ""), same);

// Step 39Y: the minimum order applies once to the whole display
{
  check("39Y: top-up = min - (parts + assembly)", displayMinimumTopUp(100, 20, 150) === 30);
  check("39Y: no top-up when the display reaches the minimum", displayMinimumTopUp(140, 10, 150) === 0 && displayMinimumTopUp(600, 50, 150) === 0);
  check("39Y: no minimum set = no top-up", displayMinimumTopUp(10, 0, 0) === 0 && displayMinimumTopUp(10, 0, null) === 0);
  check("39Y: a part without a price = no top-up", displayMinimumTopUp(null, 0, 150) === 0);
  const a = priceAssembly({ rates: assemblyRatesFrom({ kit_per_display_usd: 1, markup_pct: 0 }), displays: 10, partsPerDisplay: 3 });
  const t = withMinimumTopUp(a, 35.5, 150);
  check("39Y: top-up added to the assembly line", t.total_usd === 45.5 && t.unit_usd === 4.55 && t.min_topup_usd === 35.5 && t.min_order_usd === 150, t);
  check("39Y: no top-up leaves the line as is", withMinimumTopUp(a, 0, 150) === a);
  check(
    "39Y: description says it",
    assemblyDescription(t) === "Assembly and packing: 10 displays, 3 parts each (includes $35.50 to reach the $150.00 minimum order)" &&
      assemblyDescription(a) === "Assembly and packing: 10 displays, 3 parts each",
    assemblyDescription(t),
  );
  // Chuck's display (Oct 24): four CAD-cut parts at 50 pieces were each raised to $150.
  const settings = {
    waste_pct: 10, order_setup_usd: 75, converting_per_m: 120, plate_spot_usd: 150, plate_flood_usd: 300, print_setup_per_color_usd: 40,
    print_run_spot_per_m: 25, print_run_flood_per_m: 45, markup_pct: 35, min_order_usd: 150, digital_under_qty: 51, cad_setup_usd: 25,
    cad_cut_per_hr_usd: 50, cad_speed_in_per_min: 1500, digital_setup_usd: 50, digital_per_sqft_usd: 0.01, sheet_trim_in: 0, sheet_round_to_in: 0,
    sheet_max_length_in: 0, sheet_max_width_in: 0, sheet_max_up: 6, sheet_min_msf: 0, diecut_per_m: 180, die_base_usd: 250, die_per_in_usd: 1.5,
    pad_per_m: 40, partition_per_m: 250, joint_type: "glued", flap_pct: 50, round_to_in: 0.0625, edge_trim_in: 0, board_method: "blank",
  };
  const flute = DEFAULT_FLUTES.find((f) => f.flute === "C")!;
  const part7 = { length_in: 8.272, width_in: 20.25, cut_in: 60, crease_in: 20, perf_in: 0, rule_in: 80 };
  const price = (min: number) =>
    priceRscBox({
      dims: { L: part7.length_in, W: part7.width_in, D: 0 },
      quantities: [50],
      print: { colors: [], sides: 1 },
      grade: { name: "32 ECT C", cost_per_msf: 90 },
      flute,
      settings: { ...settings, min_order_usd: min } as never,
      method: "digital",
      style: "dieline",
      cells: null,
      dieline: part7,
    } as never);
  const withMin = price(150);
  const without = price(0);
  check(
    "39Y: a small part alone is raised to the minimum; priced as a display part it isn't",
    withMin.ok && without.ok && withMin.quantities[0].box_total_usd === 150 && without.quantities[0].box_total_usd < 150 && !without.quantities[0].min_applied,
    withMin.ok && without.ok && [withMin.quantities[0].box_total_usd, without.quantities[0].box_total_usd],
  );
}

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
