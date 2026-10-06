// scripts/test-corrugated-price.ts
//
// Tests for the custom RSC pricing engine, built from the spec's worked
// example (12 x 10 x 8 C-flute, 1-color spot, placeholder rates).
// Run: npm run test:corrugated   (= npx --yes tsx scripts/test-corrugated-price.ts)

import { DEFAULT_FLUTES } from "../lib/corrugated-blank";
import { priceRscBox, type BoxSettings, type PriceRscInput } from "../lib/corrugated-price";

const C = DEFAULT_FLUTES.find((f) => f.flute === "C")!;

const settings: BoxSettings = {
  waste_pct: 10,
  order_setup_usd: 75,
  converting_per_m: 60,
  plate_spot_usd: 150,
  plate_flood_usd: 200,
  print_setup_per_color_usd: 50,
  print_run_spot_per_m: 25,
  print_run_flood_per_m: 40,
  markup_pct: 30,
  min_order_usd: 250,
  joint_type: "glued",
  flap_pct: 50,
  round_to_in: 0.0625,
  edge_trim_in: 0,
};

const base: PriceRscInput = {
  dims: { L: 12, W: 10, D: 8 },
  quantities: [1000, 5000],
  print: { colors: ["spot"], sides: 1 },
  grade: { name: "32 ECT C", cost_per_msf: 85 },
  flute: C,
  settings,
};

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log("PASS", name);
  } else {
    failed++;
    console.log("FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

// 1. Spec worked example
const r1 = priceRscBox(base);
if (!r1.ok) {
  check("worked example prices", false, r1);
} else {
  const [q1, q5] = r1.quantities;
  check("blank 46.125 x 18.375", r1.blank.length_in === 46.125 && r1.blank.width_in === 18.375, r1.blank);
  check("board @1,000 = $550.32", near(q1.board_usd, 550.32), q1);
  check("box total @1,000 = $988.41", near(q1.box_total_usd, 988.41), q1);
  check("unit @1,000 = $0.9884", q1.unit_price_usd === 0.9884, q1);
  check("unit @5,000 = $0.8584", q5.unit_price_usd === 0.8584, q5);
  check("plates line = $195.00", r1.plates_line_usd === 195, r1.plates_line_usd);
  check("minimum not applied", !q1.min_applied && !q5.min_applied);
  check("no warnings with full rates", r1.warnings.length === 0, r1.warnings);
}

// 2. Minimum order, unprinted
const r2 = priceRscBox({ ...base, quantities: [10], print: { colors: [], sides: 1 } });
if (!r2.ok) {
  check("minimum case prices", false, r2);
} else {
  const q = r2.quantities[0];
  check("minimum applied: box total $250, unit $25", q.min_applied && q.box_total_usd === 250 && q.unit_price_usd === 25, q);
  check("unprinted: no plates", r2.plates_line_usd === 0, r2.plates_line_usd);
  check("unprinted: setup = order setup only", q.setup_usd === 75, q);
}

// 3. Two colors (spot + flood), two sides
const r3 = priceRscBox({ ...base, quantities: [1000], print: { colors: ["spot", "flood"], sides: 2 } });
if (!r3.ok) {
  check("2 colors / 2 sides prices", false, r3);
} else {
  const q = r3.quantities[0];
  check("2c/2s plates line = $910", r3.plates_line_usd === 910, r3.plates_line_usd);
  check("2c/2s print run = $130", q.print_run_usd === 130, q);
  check("2c/2s setup = $275", q.setup_usd === 275, q);
}

// 4. Errors
const e1 = priceRscBox({ ...base, grade: { name: "44 ECT C", cost_per_msf: null } });
check("grade without cost -> grade_no_cost", !e1.ok && e1.error === "grade_no_cost", e1);
const e2 = priceRscBox({ ...base, quantities: [0] });
check("qty 0 -> invalid_quantities", !e2.ok && e2.error === "invalid_quantities", e2);
const e3 = priceRscBox({ ...base, dims: { L: 12, W: 0, D: 8 } });
check("width 0 -> invalid_dims", !e3.ok && e3.error === "invalid_dims", e3);
const e4 = priceRscBox({ ...base, print: { colors: ["spot", "spot", "spot", "spot", "spot"], sides: 1 } });
check("5 colors -> invalid_print", !e4.ok && e4.error === "invalid_print", e4);

// 5. Quantities sorted and de-duplicated
const r5 = priceRscBox({ ...base, quantities: [5000, 1000, 1000] });
check(
  "quantities sorted + de-duplicated",
  r5.ok && r5.quantities.map((q) => q.quantity).join(",") === "1000,5000",
  r5.ok ? r5.quantities.map((q) => q.quantity) : r5,
);

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
