// scripts/test-foam-price.ts
//
// Step 22: tests for the shared foam price formula (app/lib/pricing/foam-core.ts),
// used by /api/quotes/calc and computePricing(). Expected totals are from the
// live Step 20 check (EPE 2.2# Black, 12 x 10 x 2, qty 250) and the foam
// audit's worked example.
// Run: npm run test:foam   (= npx --yes tsx scripts/test-foam-price.ts)

import { cavityVolumeCi, priceFoam, type FoamMaterial, type FoamSettings } from "../app/lib/pricing/foam-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok =
    typeof want === "number" && typeof got === "number" ? Math.abs(got - want) < 0.005 : got === want;
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Default shop settings as saved live (markup 1.45, skive $4.50/pc, no shop minimum).
const shop: FoamSettings = {
  ratePerCI_default: 0.06,
  ratePerBF_default: 34,
  kerf_pct_default: 0,
  min_charge_default: 0,
  skive_upcharge_each: 4.5,
  markup_factor_default: 1.45,
};

// EPE 2.2# Black (catalog): $0.024/cu in, 10% waste, $25 minimum, $60 setup.
const epe22: FoamMaterial = {
  name: "EPE 2.2# Black",
  price_per_cuin: 0.024,
  price_per_bf: null,
  cost_per_ci_usd: 0.05,
  kerf_waste_pct: 10,
  min_charge_usd: 25,
  skiving_upcharge_pct: null,
  cutting_setup_fee_usd: 60,
};
const part = { L: 12, W: 10, H: 2, qty: 250 };

// 1) Live Step 20 numbers
check("catalog price (live $2,383.80)", priceFoam(epe22, shop, part).total, 2383.8);
check(
  "shop override 0.030 / $50 / 20% (live $3,219.00)",
  priceFoam({ ...epe22, price_per_cuin: 0.03, min_charge_usd: 50, kerf_waste_pct: 20 }, shop, part).total,
  3219.0,
);
check("price-only override 0.030 (live $2,958.00)", priceFoam({ ...epe22, price_per_cuin: 0.03 }, shop, part).total, 2958.0);
check("source = price_per_cuin", priceFoam(epe22, shop, part).price_source, "price_per_cuin");

// 2) Audit worked example: $6.50/bf, 10% waste, $15 min, no setup
const pe22: FoamMaterial = {
  name: "PE 2.2 lb",
  price_per_cuin: null,
  price_per_bf: 6.5,
  cost_per_ci_usd: null,
  kerf_waste_pct: 10,
  min_charge_usd: 15,
  skiving_upcharge_pct: null,
  cutting_setup_fee_usd: null,
};
check("audit example, solid block ($4,319.79)", priceFoam(pe22, shop, part).total, 4319.79);
check(
  "audit example, two 4x3x1 cavities ($3,887.81)",
  priceFoam(pe22, shop, { ...part, cavities: ["4x3x1", "4x3x1"] }).total,
  3887.81,
);
check("source = price_per_bf", priceFoam(pe22, shop, part).price_source, "price_per_bf");

// 3) Cost-only material: shop markup only (no hidden x1.35). 66,000 ci x 0.06 x 1.45 = 5,742
const costOnly: FoamMaterial = { ...epe22, name: "PU Ester 1560", price_per_cuin: null, cost_per_ci_usd: 0.06, cutting_setup_fee_usd: null };
const c = priceFoam(costOnly, shop, part);
check("cost-only: price per ci = cost", c.price_per_ci, 0.06);
check("cost-only: total = cost x waste x shop markup", c.total, 5742.0);
check("cost-only: source", c.price_source, "cost");
check("cost-only: not flagged", c.needs_review, false);

// 4) Unpriced material: shop default rate + needs_review
const unpriced: FoamMaterial = { ...costOnly, name: "Mystery foam", cost_per_ci_usd: null };
const u = priceFoam(unpriced, shop, part);
check("unpriced: shop default rate", u.price_per_ci, 0.06);
check("unpriced: flagged", u.needs_review, true);
check("unpriced: source", u.price_source, "shop_default");
check("unpriced, no rates set: 0.06 fallback (not ~$0)", priceFoam(unpriced, { markup_factor_default: 1 }, part).price_per_ci, 0.06);
check("unpriced: bf default used when no ci default", priceFoam(unpriced, { ratePerBF_default: 34 }, part).price_per_ci, 0.2361);
check("zero price falls through to the next source", priceFoam({ ...epe22, price_per_cuin: 0 }, shop, part).price_source, "cost");

// 5) Skiving: 1.5" thick → $4.50/pc before markup.
//    piece 180 ci x 250 x 1.1 = 49,500 x 0.024 = 1,188 + 1,125 + 60 = 2,373 x 1.45 = 3,440.85
check("skive: flat $ per piece", priceFoam(epe22, shop, { ...part, H: 1.5 }).total, 3440.85);
check("skive: forced on a whole-inch part", priceFoam(epe22, shop, { ...part, force_skived: true }).is_skived, true);
//    material % instead: (1,584 x 1.10 + 60) x 1.45 = 2,613.48
check("skive: material % upcharge", priceFoam({ ...epe22, skiving_upcharge_pct: 10 }, shop, { ...part, force_skived: true }).total, 2613.48);

// 6) Board-foot rounding keeps skive and setup.
//    66,000 ci / 144 = 458.33 bf → 458.5 bf x $3.46/bf (0.024 x 144, to the cent) = 1,586.41 + 60 = 1,646.41 x 1.45 = 2,387.29
const bf = priceFoam(epe22, shop, { ...part, round_to_bf: true });
check("round_to_bf: quarter board feet", bf.board_feet_rounded, 458.5);
check("round_to_bf: keeps setup", bf.total, 2387.29);

// 7) Minimum charge (per order)
const tiny = priceFoam({ ...epe22, cutting_setup_fee_usd: null }, shop, { L: 2, W: 2, H: 1, qty: 1 });
check("minimum charge applies", tiny.total, 25);
check("minimum charge flagged", tiny.used_min_charge, true);
check("shop minimum when material has none", priceFoam({ ...epe22, min_charge_usd: null, cutting_setup_fee_usd: null }, { ...shop, min_charge_default: 40 }, { L: 2, W: 2, H: 1, qty: 1 }).total, 40);

// 8) Cavity volumes
check("round cavity Ø6x1", Math.round(cavityVolumeCi("Ø6x1") * 1000) / 1000, 28.274);
check("rect cavity 2x3x0.5", cavityVolumeCi("2x3x0.5"), 3);
check("cavities never go below zero volume", priceFoam(epe22, shop, { ...part, cavities: ["20x20x5"] }).piece_ci, 0);

// 9) Markup fallback
check("invalid markup → 1", priceFoam(epe22, { ...shop, markup_factor_default: 0 }, part).markup_factor, 1);

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
