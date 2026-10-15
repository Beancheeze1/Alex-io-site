// scripts/test-freight.ts
//
// Step 30: tests for the freight estimate (app/lib/freight-core.ts):
// ZIP distance and zones, packing (foam cartons, flat boxes), parcel vs LTL,
// terms (prepaid & add / collect / pickup), free freight, markup, staff
// override, and the settings check.
// Run: npm run test:freight   (= npx --yes tsx scripts/test-freight.ts)

import {
  FREIGHT_DEFAULTS,
  blankAreaIn2,
  cleanFreightSettings,
  cleanZip,
  estimateFreight,
  freightLockKey,
  lockableFreight,
  milesBetweenZips,
  packLoad,
  zoneFor,
  type FreightSettings,
} from "../app/lib/freight-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = typeof want === "number" && typeof got === "number" ? Math.abs(got - want) < 0.005 : got === want;
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function near(name: string, got: number | null, lo: number, hi: number) {
  check(`${name} (${got})`, got != null && got >= lo && got <= hi, true);
}

const S: FreightSettings = { ...FREIGHT_DEFAULTS, ship_from_zip: "44875" }; // Shelby, OH

// ZIPs, distance, zones
check("ZIP+4 cleaned", cleanZip("44875-1234"), "44875");
check("bad ZIP", cleanZip("4487"), null);
near("Shelby OH -> Chicago miles", milesBetweenZips("44875", "60601"), 230, 290);
near("Shelby OH -> New York miles", milesBetweenZips("44875", "10001"), 420, 500);
near("Shelby OH -> Los Angeles miles", milesBetweenZips("44875", "90001"), 1900, 2100);
check("unknown prefix -> null", milesBetweenZips("44875", "00000"), null);
check("150 mi = zone 1", zoneFor(150, S.zone_miles), 1);
check("151 mi = zone 2", zoneFor(151, S.zone_miles), 2);
check("2000 mi = zone 7", zoneFor(2000, S.zone_miles), 7);

// Packing
const foam250 = [{ l: 12, w: 10, h: 2, qty: 250, density_pcf: 2.2 }];
const p1 = packLoad(foam250, [], S);
check("foam weight 12x10x2 x250 @2.2#", p1.foam_lb, 76.4);
check("foam cartons (24x18x18 at 85%)", p1.cartons, 10);
check("actual incl. cartons", p1.actual_lb, 96.4);
check("RSC blank area 12x10x8", blankAreaIn2({ l: 12, w: 10, h: 8, style: "rsc" }), 819);
check("pad blank area 12x10", blankAreaIn2({ l: 12, w: 10, h: 0, style: "pad" }), 120);
const boxes500 = [{ l: 12, w: 10, h: 8, qty: 500, style: "rsc", flute: "C" }];
const p2 = packLoad([], boxes500, S);
check("500 RSC C-flute weight", p2.box_lb, 341.3);
check("500 RSC flat -> cartons", p2.cartons, 10);

// LTL: foam 250 pcs to Chicago (zone 2) = 1 pallet x $225
const ltl = estimateFreight({ s: S, terms: "prepaid_add", toZip: "60601", foam: foam250, boxes: [], subtotal: 1000 });
check("bulky foam goes LTL (dim weight)", ltl.mode, "ltl");
check("1 pallet", ltl.pallets, 1);
check("zone 2", ltl.zone, 2);
check("LTL cost zone 2", ltl.cost, 225);
check("prepaid in total", ltl.in_total, true);
check("pallet weight added", ltl.actual_lb, 136.4);

// Parcel: 50 pcs 10x8x1 @1.7# to Chicago: 56 lb billable (dim) x 0.65 + 9
const small = [{ l: 10, w: 8, h: 1, qty: 50, density_pcf: 1.7 }];
const par = estimateFreight({ s: S, terms: "prepaid_add", toZip: "60601", foam: small, boxes: [], subtotal: 300 });
check("small order parcel", par.mode, "parcel");
check("1 carton", par.cartons, 1);
check("billable = dim weight", par.billable_lb, 56);
check("parcel cost", par.cost, 45.4);
check("markup 10%", estimateFreight({ s: { ...S, markup_pct: 10 }, terms: "prepaid_add", toZip: "60601", foam: small, boxes: [], subtotal: 300 }).cost, 49.94);

// LTL minimum
check("LTL minimum applies", estimateFreight({ s: { ...S, ltl_per_pallet: [100, 100, 100, 100, 100, 100, 100] }, terms: "prepaid_add", toZip: "60601", foam: foam250, boxes: [], subtotal: 1000 }).cost, 200);

// Terms
const fob = estimateFreight({ s: S, terms: "fob_origin", toZip: "60601", foam: foam250, boxes: [], subtotal: 1000 });
check("collect not in total", fob.in_total, false);
check("collect cost 0", fob.cost, 0);
check("collect still estimates", fob.estimate, 225);
const pick = estimateFreight({ s: S, terms: "pickup", toZip: null, foam: foam250, boxes: [], subtotal: 1000 });
check("pickup status", pick.status, "pickup");
check("pickup no cost", pick.cost, 0);
check("no ship-to ZIP", estimateFreight({ s: S, terms: "prepaid_add", toZip: "", foam: foam250, boxes: [], subtotal: 1000 }).status, "needs_zip");
check("shop not set up", estimateFreight({ s: FREIGHT_DEFAULTS, terms: "prepaid_add", toZip: "60601", foam: foam250, boxes: [], subtotal: 1000 }).status, "not_set_up");
check("nothing to ship", estimateFreight({ s: S, terms: "prepaid_add", toZip: "60601", foam: [], boxes: [], subtotal: 0 }).status, "nothing_to_ship");

// Free freight and override
const free = estimateFreight({ s: { ...S, free_over_usd: 1500 }, terms: "prepaid_add", toZip: "60601", foam: foam250, boxes: [], subtotal: 2000 });
check("free freight over $1,500", free.status, "free");
check("free = $0 in total", free.cost, 0);
check("under the free amount pays", estimateFreight({ s: { ...S, free_over_usd: 1500 }, terms: "prepaid_add", toZip: "60601", foam: foam250, boxes: [], subtotal: 1499 }).cost, 225);
const ov = estimateFreight({ s: S, terms: "prepaid_add", toZip: null, foam: [], boxes: [], subtotal: 0, overrideUsd: 312.5 });
check("staff override wins (no ZIP needed)", ov.status, "override");
check("override cost", ov.cost, 312.5);
check("override with collect not in total", estimateFreight({ s: S, terms: "fob_origin", toZip: null, foam: [], boxes: [], subtotal: 0, overrideUsd: 80 }).in_total, false);

// Mixed foam + boxes
const mix = estimateFreight({ s: S, terms: "prepaid_add", toZip: "10001", foam: small, boxes: boxes500, subtotal: 900 });
check("foam + boxes cartons add up", mix.cartons, 11);
check("mixed goes LTL", mix.mode, "ltl");
check("New York = zone 3", mix.zone, 3);

// Step 30B: kept freight key
const k = freightLockKey("prepaid_add", "60601-1234", null, 857.94);
check("lock key", k, "prepaid_add|60601||85794");
check("same inputs -> same key", freightLockKey("prepaid_add", "60601", null, 857.94), k);
check("ZIP change -> new key", freightLockKey("prepaid_add", "10001", null, 857.94) === k, false);
check("terms change -> new key", freightLockKey("fob_origin", "60601", null, 857.94) === k, false);
check("charges change -> new key", freightLockKey("prepaid_add", "60601", null, 857.95) === k, false);
check("override in key", freightLockKey("prepaid_add", "60601", 150, 857.94), "prepaid_add|60601|15000|85794");
check("estimated is kept", lockableFreight(ltl), true);
check("free is kept", lockableFreight(free), true);
check("pickup not kept", lockableFreight(pick), false);
check("needs ZIP not kept", lockableFreight(estimateFreight({ s: S, terms: "prepaid_add", toZip: "", foam: foam250, boxes: [], subtotal: 1 })), false);

// Settings check
check("defaults clean", cleanFreightSettings(null).zone_miles.join(","), "150,300,600,1000,1400,1800");
const thrown = (raw: unknown) => {
  try {
    cleanFreightSettings(raw, true);
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
};
check("bad ship-from ZIP refused", thrown({ ship_from_zip: "123" }), "Ship-from ZIP must be a US ZIP code.");
check("zones must go up", thrown({ zone_miles: [150, 100, 600, 1000, 1400, 1800] }), "Zone miles must go up from zone 1 to zone 6.");
check("need a term", thrown({ terms_allowed: [] }), "Allow at least one freight term.");
check("default must be allowed", thrown({ terms_allowed: ["pickup"], default_terms: "prepaid_add" }), "The default freight term must be one of the allowed terms.");
check("7 parcel rates", thrown({ parcel_per_lb: [1, 2] }), "Parcel $/lb needs 7 values.");
check("good settings pass", thrown({ ship_from_zip: "44875-0001", free_over_usd: 2500 }), "ok");
check("ZIP+4 saved as 5 digits", cleanFreightSettings({ ship_from_zip: "44875-0001" }, true).ship_from_zip, "44875");

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
