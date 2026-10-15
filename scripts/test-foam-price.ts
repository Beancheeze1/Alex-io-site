// scripts/test-foam-price.ts
//
// Step 22: tests for the shared foam price formula (app/lib/pricing/foam-core.ts),
// used by /api/quotes/calc and computePricing(). Expected totals are from the
// live Step 20 check (EPE 2.2# Black, 12 x 10 x 2, qty 250) and the foam
// audit's worked example.
// Run: npm run test:foam   (= npx --yes tsx scripts/test-foam-price.ts)

import { cavityVolumeCi, priceFoam, type FoamMaterial, type FoamSettings } from "../app/lib/pricing/foam-core";
import { foamGeometry } from "../app/lib/pricing/foam-geometry";
import { pickFoamProcess, priceFoamProcess, resolveFoamMethod } from "../app/lib/pricing/foam-process";
import { cleanQtyList, foamBreakList } from "../app/lib/pricing/qty-list";
import { reviewFoam } from "../app/lib/pricing/foam-review";
import { buyerCanAccept, cleanText, computeApproval, staffCanConfirm } from "../app/lib/quote-approval-core";

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

// 6) Board-foot rounding keeps skive and setup, and uses the rate actually charged.
//    66,000 ci / 144 = 458.33 bf → 458.5 bf x $3.46/bf (0.024 x 144, to the cent) = 1,586.41 + 60 = 1,646.41 x 1.45 = 2,387.29
const bf = priceFoam(epe22, shop, { ...part, round_to_bf: true });
check("round_to_bf: quarter board feet", bf.board_feet_rounded, 458.5);
check("round_to_bf: keeps setup", bf.total, 2387.29);
// Step 23: a stale stored $/bf (catalog has $34/bf next to $0.024/cu in) is ignored.
check("round_to_bf: ignores a stale stored $/bf", priceFoam({ ...epe22, price_per_bf: 34 }, shop, { ...part, round_to_bf: true }).total, 2387.29);

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


// ---------------------------------------------------------------------------
// Step 23: layout geometry (cavities, cut length, dies, glue lines)
// ---------------------------------------------------------------------------
const twoLayer = {
  block: { lengthIn: 12, widthIn: 10, thicknessIn: 2 },
  stack: [
    {
      thicknessIn: 1,
      cavities: [
        { shape: "rect", lengthIn: 4, widthIn: 3, depthIn: 0.5, x: 0.1, y: 0.1 },
        { shape: "circle", lengthIn: 2, widthIn: 2, diameterIn: 2, depthIn: 1, x: 0.6, y: 0.5 },
      ],
    },
    { thicknessIn: 1, cavities: [] },
  ],
};
const g = foamGeometry(twoLayer, { L: 12, W: 10, H: 2 });
//   cavities: 4x3x0.5 = 6 + π·1²·1 = 3.1416 → 9.1416 cu in
check("geom: cavity volume (rect + circle)", Math.round(g.cavity_ci * 1000) / 1000, 9.142);
//   cut: layer 1 = 44 + 14 + 2π (6.2832) = 64.2832; layer 2 = 44 → 108.283
check("geom: cut inches per part", g.cut_in_per_piece, 108.283);
check("geom: 2 different layers → 2 dies", g.dies.length, 2);
check("geom: rule inches", g.rule_in_total, 108.283);
check("geom: 2 layers → 1 glue line", g.glue_lines, 1);
check("geom: layers cut", g.layers_cut, 2);
check("geom: from layout", g.from_layout, true);

const sameLayers = foamGeometry(
  { block: { lengthIn: 12, widthIn: 10, thicknessIn: 3 }, stack: [{ thicknessIn: 1, cavities: [] }, { thicknessIn: 1, cavities: [] }, { thicknessIn: 1, cavities: [], loose: true }] },
  { L: 12, W: 10, H: 3 },
);
check("geom: identical layers share one die", sameLayers.dies.length, 1);
check("geom: loose top pad is not glued", sameLayers.glue_lines, 1);

const shapes = foamGeometry(
  {
    block: { lengthIn: 12, widthIn: 10, thicknessIn: 2, cornerStyle: "chamfer", chamferIn: 1 },
    cavities: [
      { shape: "roundedRect", lengthIn: 4, widthIn: 3, cornerRadiusIn: 0.5, depthIn: 1, x: 0, y: 0 },
      { shape: "poly", lengthIn: 6, widthIn: 5, depthIn: 5, x: 0.5, y: 0.5, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] },
    ],
  },
  { L: 12, W: 10, H: 2 },
);
//   rounded rect 4x3 r0.5: 12 − (4−π)·0.25 = 11.7854 × 1 deep; poly 6x5 = 30 × min(5, 2) = 60 → 71.785
check("geom: rounded rect + poly volume (depth capped at the layer)", Math.round(shapes.cavity_ci * 1000) / 1000, 71.785);
//   chamfered outline 44 − 4·1·(2−√2) = 41.657; + rounded rect 13.1416 + poly 22 → 76.799
check("geom: chamfer + rounded rect + poly cut", shapes.cut_in_per_piece, 76.799);
check("geom: no layout → solid block", foamGeometry(null, { L: 12, W: 10, H: 2 }).cut_in_per_piece, 44);

// Material line with the layout's cavities: (240 − 9.1416) × 250 × 1.1 × 0.024 = 1,523.67 + 60 = 1,583.67 × 1.45
check("material: layout cavities come off the volume", priceFoam(epe22, shop, { ...part, cavity_ci: g.cavity_ci }).total, 2296.31);

// ---------------------------------------------------------------------------
// Step 23: cutting + lamination charges
// ---------------------------------------------------------------------------
const proc = pickFoamProcess({
  foam_die_over_qty: 500,
  cnc_setup_usd: 50,
  cnc_feed_in_per_min: 100,
  cnc_cost_per_min: 2,
  die_base_usd: 75,
  die_rule_per_in_usd: 1.5,
  press_setup_usd: 40,
  press_rate_per_hr: 120,
  press_hits_per_hr: 600,
  press_parts_per_hit: 1,
  lam_setup_usd: 25,
  lam_per_glue_line_usd: 0.1,
});
const legacy = { trigger_qty: 50, upcharge_usd: 100, qty: 0 };
check("method: auto below the cutoff = CNC", resolveFoamMethod("auto", 100, proc), "cnc");
check("method: auto at the cutoff = die", resolveFoamMethod("auto", 500, proc), "die");
check("method: staff can force CNC", resolveFoamMethod("cnc", 5000, proc), "cnc");
check("method: no rates = old fee", resolveFoamMethod("auto", 100, pickFoamProcess({})), null);

//   CNC, qty 100: 50 + (108.283 ÷ 100 × 100 = 108.283 min) × $2 = 266.566 × 1.45 = 386.52
const cnc = priceFoamProcess({ model: 2, geom: g, qty: 100, settings: proc, markup: 1.45, legacy });
check("CNC: method", cnc.method, "cnc");
check("CNC: charge", cnc.lines.find((l) => l.key === "cnc")?.amount, 386.52);
//   lamination, qty 100: 25 + 100 × 1 × 0.10 = 35 × 1.45 = 50.75
check("lamination: charge", cnc.lines.find((l) => l.key === "lamination")?.amount, 50.75);
check("CNC: no old die-cut fee", cnc.lines.some((l) => l.key === "die_cut_legacy"), false);

//   Die, qty 1000: (75 + 64.2832 × 1.5) + (75 + 44 × 1.5) = 312.4248 × 1.45 = 453.02
const die = priceFoamProcess({ model: 2, geom: g, qty: 1000, settings: proc, markup: 1.45, legacy });
check("die: method", die.method, "die");
check("die: one-time charge (2 dies)", die.lines.find((l) => l.key === "die")?.amount, 453.02);
//   press: 1000 parts × 2 layers = 2,000 hits ÷ 600/hr × $120 = 400 + 40 = 440 × 1.45 = 638.00
check("press: charge", die.lines.find((l) => l.key === "press")?.amount, 638.0);
check("press: hits", die.detail.press_hits, 2000);
const owned = priceFoamProcess({ model: 2, geom: g, qty: 1000, settings: proc, markup: 1.45, dieOwned: true, legacy });
check("die: customer owns the die → $0", owned.lines.find((l) => l.key === "die")?.amount, 0);
check("die: press still charged when the die is owned", owned.lines.find((l) => l.key === "press")?.amount, 638.0);

// Old flat fee: model 1 quotes, and shops with no CNC / die rates
const m1 = priceFoamProcess({ model: 1, geom: g, qty: 100, settings: proc, markup: 1.45, legacy: { ...legacy, qty: 100 } });
check("model 1: old flat die-cut fee only", m1.lines.map((l) => `${l.key}:${l.amount}`).join(","), "die_cut_legacy:100");
const noRates = priceFoamProcess({ model: 2, geom: g, qty: 100, settings: pickFoamProcess({}), markup: 1.45, legacy: { ...legacy, qty: 100 } });
check("no CNC/die rates: old flat fee", noRates.total, 100);
const noRatesLow = priceFoamProcess({ model: 2, geom: g, qty: 10, settings: pickFoamProcess({}), markup: 1.45, legacy: { ...legacy, qty: 10 } });
check("no rates, under the old trigger: nothing", noRatesLow.lines.length, 0);

// ---------------------------------------------------------------------------
// Step 24: compare quantities
// ---------------------------------------------------------------------------
check("qty list: comma string", cleanQtyList("1000, 250,500").join(","), "250,500,1000");
check("qty list: rep breaks [{qty, price}]", cleanQtyList([{ qty: 500, price: 1.2 }, { qty: 100, price: null }]).join(","), "100,500");
check("qty list: junk dropped", cleanQtyList(["x", -5, 2.5, 0, "300", 300]).join(","), "300");
check("qty list: JSON string", cleanQtyList("[50,25]").join(","), "25,50");
check("breaks: ordered qty always kept, up to 3 others", foamBreakList(100, [25, 50, 250, 500, 1000]).join(","), "25,50,100,250");
check("breaks: duplicates of the ordered qty dropped", foamBreakList(100, [100, 500]).join(","), "100,500");
check("breaks: nothing to compare", foamBreakList(100, []).length, 1);

// CNC → die switch by quantity (cutoff 500) on the same part
check("price by qty: 100 is CNC", priceFoamProcess({ model: 2, geom: g, qty: 100, settings: proc, markup: 1.45, legacy }).method, "cnc");
check("price by qty: 1,000 is die", priceFoamProcess({ model: 2, geom: g, qty: 1000, settings: proc, markup: 1.45, legacy }).method, "die");

// ---------------------------------------------------------------------------
// Step 25: review flags
// ---------------------------------------------------------------------------
const rs = { foam_min_wall_in: 0.25, foam_min_feature_in: 0.25 };
const codes = (f: { code: string }[]) => f.map((x) => x.code).sort().join(",");
const one = (cav: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  block: { lengthIn: 12, widthIn: 10, thicknessIn: 2 },
  stack: [{ thicknessIn: 2, cavities: [cav] }],
  ...extra,
});
const base = { fallback: { L: 12, W: 10, H: 2 }, settings: rs };
check("review: clean 2-layer layout has no flags", reviewFoam({ ...base, layout: twoLayer }).length, 0);
check(
  "review: cavity 0.12\" from the edge = thin wall",
  codes(reviewFoam({ ...base, layout: one({ lengthIn: 4, widthIn: 3, depthIn: 1, x: 0.01, y: 0.3 }) })),
  "thin_wall",
);
check(
  "review: cavity past the edge",
  codes(reviewFoam({ ...base, layout: one({ lengthIn: 4, widthIn: 3, depthIn: 1, x: 0.9, y: 0.3 }) })),
  "cavity_outside",
);
check(
  "review: cavity deeper than its layer",
  codes(reviewFoam({ ...base, layout: one({ lengthIn: 4, widthIn: 3, depthIn: 2.5, x: 0.3, y: 0.3 }) })),
  "cavity_too_deep",
);
check(
  "review: tiny cavity",
  codes(reviewFoam({ ...base, layout: one({ lengthIn: 0.2, widthIn: 2, depthIn: 1, x: 0.3, y: 0.3 }) })),
  "tiny_cavity",
);
check(
  "review: overlapping cavities",
  codes(
    reviewFoam({
      ...base,
      layout: {
        block: { lengthIn: 12, widthIn: 10, thicknessIn: 2 },
        stack: [{ thicknessIn: 2, cavities: [
          { lengthIn: 4, widthIn: 3, depthIn: 1, x: 0.2, y: 0.2 },
          { lengthIn: 4, widthIn: 3, depthIn: 1, x: 0.3, y: 0.25 },
        ] }],
      },
    }),
  ),
  "cavity_overlap",
);
check(
  "review: cavities 0.1\" apart = thin wall",
  codes(
    reviewFoam({
      ...base,
      layout: {
        block: { lengthIn: 12, widthIn: 10, thicknessIn: 2 },
        stack: [{ thicknessIn: 2, cavities: [
          { lengthIn: 3, widthIn: 3, depthIn: 1, x: 0.1, y: 0.2 },
          { lengthIn: 3, widthIn: 3, depthIn: 1, x: (1.2 + 3 + 0.1) / 12, y: 0.2 },
        ] }],
      },
    }),
  ),
  "thin_wall",
);
check(
  "review: part bigger than the largest block",
  codes(reviewFoam({ ...base, layout: twoLayer, settings: { ...rs, foam_max_block_l_in: 10, foam_max_block_w_in: 8 } })),
  "oversize",
);
check(
  "review: block either way round is fine",
  reviewFoam({ ...base, layout: twoLayer, settings: { ...rs, foam_max_block_l_in: 10, foam_max_block_w_in: 12 } }).length,
  0,
);
check(
  "review: layer thicker than the thickest block",
  codes(reviewFoam({ ...base, layout: one({ lengthIn: 4, widthIn: 3, depthIn: 1, x: 0.3, y: 0.3 }), settings: { ...rs, foam_max_block_t_in: 1.5 } })),
  "oversize",
);
check(
  "review: foam doesn't fit the box",
  codes(reviewFoam({ ...base, layout: twoLayer, completePack: true, boxes: [{ L: 11.5, W: 9.5, H: 3 }] })),
  "box_too_small",
);
check(
  "review: foam fits rotated",
  reviewFoam({ ...base, layout: twoLayer, completePack: true, boxes: [{ L: 10.125, W: 12.125, H: 3 }] }).length,
  0,
);
check(
  "review: stack taller than the box",
  codes(reviewFoam({ ...base, layout: twoLayer, completePack: true, boxes: [{ L: 12.125, W: 10.125, H: 1.5 }] })),
  "box_too_shallow",
);
check("review: unpriced material", codes(reviewFoam({ ...base, layout: twoLayer, materialUnpriced: true })), "material_unpriced");
check("review: walls off when minimum is 0", reviewFoam({ ...base, layout: one({ lengthIn: 4, widthIn: 3, depthIn: 1, x: 0, y: 0 }), settings: {} }).length, 0);

// ---- Step 28: estimate -> accepted -> confirmed ----
{
  const now = new Date("2026-10-20T12:00:00Z");
  const terms = { quote_valid_days: 30, lead_time_text: "3-4 weeks" };
  const base = { created_at: "2026-10-15T12:00:00Z" };
  const e = computeApproval(base, 1000, terms, now);
  check("new quote is an estimate", e.stage, "estimate");
  check("expires 30 days after it was created", e.expires_at, "2026-11-14T12:00:00.000Z");
  check("not expired yet", e.expired, false);
  check("shop lead time shown", e.lead_time, "3-4 weeks");
  check("buyer can accept an estimate", buyerCanAccept(e, false), true);
  check("released quote can't be accepted", buyerCanAccept(e, true), false);
  check("staff can't confirm an estimate", staffCanConfirm(e), false);

  const acc = { ...base, accepted_at: "2026-10-16T12:00:00Z", accepted_name: "Pat", accepted_total: 1000 };
  const a1 = computeApproval(acc, 1000, terms, now);
  check("accepted at the current total", a1.stage, "accepted");
  check("staff can confirm", staffCanConfirm(a1), true);
  check("buyer can't accept twice", buyerCanAccept(a1, false), false);
  check("price change after acceptance -> needs re-approval", computeApproval(acc, 1000.01, terms, now).stage, "needs_reapproval");
  check("buyer can re-approve a changed price", buyerCanAccept(computeApproval(acc, 1100, terms, now), false), true);

  const conf = { ...acc, confirmed_at: "2026-10-17T12:00:00Z", confirmed_by: "Chuck", confirmed_total: 1000 };
  check("confirmed at the current total", computeApproval(conf, 1000, terms, now).stage, "confirmed");
  check("price change after confirmation -> needs re-approval", computeApproval(conf, 990, terms, now).stage, "needs_reapproval");
  check("same total to the cent counts as unchanged", computeApproval(conf, 1000.004, terms, now).stage, "confirmed");

  const late = new Date("2026-11-20T12:00:00Z");
  const ex = computeApproval(base, 1000, terms, late);
  check("past 30 days -> expired", ex.expired, true);
  check("expired quote can't be accepted", buyerCanAccept(ex, false), false);
  check("confirmed quotes don't expire", computeApproval(conf, 1000, terms, late).expired, false);
  check("reprice restarts the clock", computeApproval({ ...base, priced_at: "2026-11-10T12:00:00Z" }, 1000, terms, late).expired, false);
  check("staff expiry date wins", computeApproval({ ...base, expires_at: "2026-12-31T23:59:59Z" }, 1000, terms, late).expires_at, "2026-12-31T23:59:59.000Z");
  check("0 days = never expires", computeApproval(base, 1000, { quote_valid_days: 0 }, late).expires_at, null);
  check("quote lead time overrides the shop's", computeApproval({ ...base, lead_time_text: "2 weeks" }, 1000, terms, now).lead_time, "2 weeks");
  check("no price -> can't accept", buyerCanAccept(computeApproval(base, 0, terms, now), false), false);
  check("cleanText trims and caps", cleanText("  PO   123  ", 5), "PO 12");
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
