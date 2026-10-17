// scripts/test-quote-email.ts
//
// Step 37J: the customer quote email (app/lib/email/quoteTemplate.ts) for a
// boxes-only quote vs a foam quote.
// Run: npm run test:quote-email   (= npx --yes tsx scripts/test-quote-email.ts)

import { renderQuoteEmail } from "../app/lib/email/quoteTemplate";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const base = {
  customerLine: "Pat • pat@example.com",
  quoteNumber: "Q-A-261017-00001",
  status: "applied",
  material: { name: null, density_lbft3: null, kerf_pct: null, min_charge: null },
  missing: [],
  validUntil: "Nov 16, 2026",
  leadTime: null,
  freightNote: null,
  quotePageUrl: "https://shop.example.com/quote?quote_no=Q-A-261017-00001",
  brand: "Test Shop",
  primaryColor: "#404040",
  onPrimary: "#FFFFFF",
  logoUrl: null,
  buyerName: "Pat",
  revisionLabel: null,
  plainLinks: true,
};

// ---- boxes only (two sizes, buyer notes)
{
  const html = renderQuoteEmail({
    ...base,
    specs: { L_in: 0, W_in: 0, H_in: 0, qty: 0, density_pcf: null, foam_family: null, cavityDims: [] },
    pricing: { total: 1934.9, used_min_charge: false, raw: {}, price_breaks: null },
    facts: { pack_type: "boxes_only", customer_notes: "stack on pallets of 250" },
    lineItems: [
      { id: 1, label: "Custom box 12 x 10 x 8 in (rsc, 32 ECT C)", sublabel: "RSC / shipper", dims: "12 × 10 × 8 in", qty: 1000, unitPrice: 1.0499, lineTotal: 1049.9, isIncluded: false, isPackaging: true },
      { id: 2, label: "Custom box 18 x 12 x 12 in (rsc, 32 ECT C)", sublabel: "RSC / shipper", dims: "18 × 12 × 12 in", qty: 500, unitPrice: 1.77, lineTotal: 885, isIncluded: false, isPackaging: true },
    ],
    foamSubtotal: 0,
    packagingSubtotal: 1934.9,
    grandTotal: 1934.9,
  } as never);
  const t = text(html);
  check("box: no 'Quantity 0' fact", !/Quantity 0/.test(t));
  check("box: no layout editor link", !t.includes("layout editor"));
  check("box: says compare quantities", t.includes("compare quantities, or accept it"));
  check("box: qty with commas", t.includes("Qty 1,000"));
  check("box: buyer notes", t.includes("Your notes: stack on pallets of 250"));
  check("box: total", t.includes("$1,934.90"));
  check("box: view link", html.includes("View your quote"));
}

// ---- foam quote keeps its facts and layout link
{
  const html = renderQuoteEmail({
    ...base,
    specs: { L_in: 12, W_in: 10, H_in: 2, qty: 250, density_pcf: 1.7, foam_family: "Polyethylene", cavityDims: [] },
    pricing: { total: 812.5, used_min_charge: false, raw: {}, price_breaks: null },
    facts: {},
    lineItems: [
      { id: 1, label: "1.7# PE", sublabel: "Polyethylene", dims: "12 × 10 × 2 in", qty: 250, unitPrice: 3.25, lineTotal: 812.5, isIncluded: false, isPackaging: false },
    ],
    foamSubtotal: 812.5,
    packagingSubtotal: 0,
    grandTotal: 812.5,
  } as never);
  const t = text(html);
  check("foam: Quantity fact", t.includes("Quantity 250"));
  check("foam: layout editor link", t.includes("Open the layout editor"));
  check("foam: says change the layout", t.includes("change the layout, or accept it"));
  check("foam: no notes line", !t.includes("Your notes"));
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
