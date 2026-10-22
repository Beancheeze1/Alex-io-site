// scripts/test-display-assembly.ts
//
// Step 39D: tests for display assembly / packing pricing (lib/display-assembly.ts).
// Run: npm run test:display   (= npx --yes tsx scripts/test-display-assembly.ts)

import {
  assemblyDescription,
  assemblyRatesFrom,
  parseAssemblyOverride,
  perDisplayOf,
  priceAssembly,
} from "../lib/display-assembly";

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

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
