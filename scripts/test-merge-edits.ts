// scripts/test-merge-edits.ts
//
// Step 44h: Admin -> Tenants saves only the fields changed in the form, on
// top of the shop's latest saved values (lib/merge-edits.ts).
// Run: npm run test:merge-edits

import { changedKeys, mergeChanged } from "../lib/merge-edits";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

type F = { logoUrl: string; heroUseLogo: boolean; aboutText: string; stats: { label: string; value: string }[]; products: string[] };
const KEYS = ["logoUrl", "heroUseLogo", "aboutText", "stats", "products"] as const;
const blank: F = { logoUrl: "", heroUseLogo: false, aboutText: "", stats: [], products: [] };

// Oct 31: the form was opened before the demo page was filled in elsewhere;
// only the logo was changed in it, and saving wiped the page.
const loaded = { ...blank };
const form = { ...blank, logoUrl: "https://x/logo.png", heroUseLogo: true };
const latest: F = { ...blank, aboutText: "About Alex-IO", stats: [{ label: "Starter", value: "$799/mo" }], products: ["foam", "rsc"] };
const m = mergeChanged(form, loaded, latest, KEYS);
check("the logo change is saved", m.logoUrl === "https://x/logo.png" && m.heroUseLogo === true, m);
check("fields saved elsewhere are kept", m.aboutText === "About Alex-IO" && m.stats.length === 1 && m.products.join() === "foam,rsc", m);
check("only the changed fields count", changedKeys(form, loaded, KEYS).join() === "logoUrl,heroUseLogo");

// A field changed in both places: the form's value wins (it's what was typed)
const m2 = mergeChanged({ ...blank, aboutText: "Typed here" }, blank, latest, KEYS);
check("a field changed in the form wins", m2.aboutText === "Typed here" && m2.products.join() === "foam,rsc", m2);

// Clearing a field in the form is a change
const m3 = mergeChanged({ ...latest, aboutText: "" }, latest, latest, KEYS);
check("clearing a field is saved", m3.aboutText === "", m3);

// Nothing changed: the latest values are saved as they are
const m4 = mergeChanged(loaded, loaded, latest, KEYS);
check("no changes: latest kept", JSON.stringify(m4) === JSON.stringify(latest), m4);

// Arrays compare by value (a re-ordered list is a change; same list is not)
check("same list is not a change", changedKeys({ ...blank, products: ["a"] }, { ...blank, products: ["a"] }, KEYS).length === 0);
check("re-ordered list is a change", changedKeys({ ...blank, products: ["b", "a"] }, { ...blank, products: ["a", "b"] }, KEYS).join() === "products");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
