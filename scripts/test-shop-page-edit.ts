// scripts/test-shop-page-edit.ts
//
// Step 45: Shop settings → Shop page (lib/shop-page-edit.ts): which fields a
// shop may change, their limits, and saving only what changed.
// Step 47: quote types (what buyers can quote online) replace the separate
// product tile list; the tiles follow them; notes for what still needs prices.
// Run: npm run test:shop-page-edit

import { cleanShopPagePatch, pricingWarnings, shopPageChanges, shopPageUrl, shopPageValues } from "../lib/shop-page-edit";
import { productsForQuoteTypes } from "../lib/tenant-products";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

// values from a theme
const v = shopPageValues({ tagline: "Hi", heroUseLogo: true, products: ["foam"], quoteTypes: ["boxes_only"], stats: [{ label: "yrs", value: "50" }, {}], brandName: "X" });
check("values: text and booleans", v.tagline === "Hi" && v.heroUseLogo === true && v.landingChatEnabled === false && v.aboutText === "", v);
check("values: quote types from the theme", v.quoteTypes.join() === "boxes_only", v.quoteTypes);
check("values: no quote types saved = every type", shopPageValues({}).quoteTypes.join() === "foam_insert,complete_pack,boxes_only");
check("values: the old tile list isn't a field any more", !("products" in v));
check("values: empty stats dropped", v.stats.length === 1, v.stats);
check("values: no brandName (owner only)", !("brandName" in v));
// tiles follow the quote types
check("tiles: boxes -> boxes, printed, mailers, displays", productsForQuoteTypes(["boxes_only"]).join() === "rsc,printed,mailer,display");
check("tiles: foam insert -> foam inserts", productsForQuoteTypes(["foam_insert"]).join() === "foam");
check("tiles: complete pack -> kits", productsForQuoteTypes(["complete_pack"]).join() === "kit");
check("tiles: all types, page order", productsForQuoteTypes(["complete_pack", "foam_insert", "boxes_only"]).join() === "rsc,printed,mailer,display,foam,kit");
check("tiles: none", productsForQuoteTypes([]).length === 0);

// clean
const ok = cleanShopPagePatch({ tagline: "  Box makers  ", primaryColor: "#1060a0", logoUrl: "https://x.com/l.png", email: "", heroUseLogo: true, brandName: "Hack", plan: "shop", products: ["rsc"], quoteTypes: ["boxes_only", "foam_insert", "boxes_only"], stats: [{ value: "50+", label: "years" }, { value: "", label: "" }] });
check("clean: good values pass, trimmed", ok.ok && ok.patch.tagline === "Box makers" && ok.patch.primaryColor === "#1060a0" && ok.patch.email === "", ok);
check("clean: owner-only and old fields ignored and listed", ok.ok && !("brandName" in ok.patch) && ok.ignored.join() === "brandName,plan,products", ok);
check("clean: quote types saved in standard order, de-duplicated", ok.ok && (ok.patch.quoteTypes as string[]).join() === "foam_insert,boxes_only", ok);
check("clean: blank stat rows dropped", ok.ok && (ok.patch.stats as unknown[]).length === 1, ok);

const bad = cleanShopPagePatch({ tagline: "x".repeat(121), primaryColor: "blue", logoUrl: "javascript:alert(1)", email: "nope", heroUseLogo: "yes", quoteTypes: ["display"], stats: [{ value: "50", label: "" }] });
check("clean: too long is an error, not trimmed", !bad.ok && /120/.test(bad.errors.tagline), bad);
check("clean: bad color", !bad.ok && !!bad.errors.primaryColor);
check("clean: only http(s) links", !bad.ok && !!bad.errors.logoUrl);
check("clean: bad email", !bad.ok && !!bad.errors.email);
check("clean: booleans must be booleans", !bad.ok && !!bad.errors.heroUseLogo);
check("clean: unknown quote type refused", !bad.ok && !!bad.errors.quoteTypes);
check("clean: no quote types refused", (() => { const r = cleanShopPagePatch({ quoteTypes: [] }); return !r.ok && /at least one/.test(r.errors.quoteTypes); })());
check("clean: half-filled stat", !bad.ok && !!bad.errors.stats);
check("clean: 5 stats refused", !cleanShopPagePatch({ stats: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "x" })) }).ok);
check("clean: about up to 1,200", cleanShopPagePatch({ aboutText: "a".repeat(1200) }).ok && !cleanShopPagePatch({ aboutText: "a".repeat(1201) }).ok);
check("clean: nothing sent is fine", (() => { const r = cleanShopPagePatch({}); return r.ok && Object.keys(r.patch).length === 0; })());

// changes
const loaded = shopPageValues({ tagline: "A", hours: "8-5", quoteTypes: ["boxes_only"], stats: [{ value: "50", label: "yrs" }], landingChatEnabled: true });
const form = { ...loaded, tagline: "B", stats: [{ value: "50", label: "yrs" }, { value: "", label: "" }, { value: "", label: "" }, { value: "", label: "" }] };
const ch = shopPageChanges(form, loaded);
check("changes: only the edited field", Object.keys(ch).join() === "tagline" && ch.tagline === "B", ch);
check("changes: padded blank stat rows aren't a change", !("stats" in ch));
check("changes: trailing spaces aren't a change", Object.keys(shopPageChanges({ ...loaded, hours: "8-5 " }, loaded)).length === 0);
check("changes: clearing is a change", shopPageChanges({ ...loaded, hours: "" }, loaded).hours === "");
check("changes: toggle off", shopPageChanges({ ...loaded, landingChatEnabled: false }, loaded).landingChatEnabled === false);
check("changes: adding a quote type", JSON.stringify(shopPageChanges({ ...loaded, quoteTypes: ["boxes_only", "foam_insert"] }, loaded).quoteTypes) === '["foam_insert","boxes_only"]');
check("changes: same types in another order isn't a change", !("quoteTypes" in shopPageChanges({ ...loaded, quoteTypes: ["boxes_only"] }, loaded)));

// notes for what still needs prices
const none = { materials: false, foam_rates: false, corrugated: false };
const all = { materials: true, foam_rates: true, corrugated: true };
check("warnings: box shop turning on foam, nothing priced: materials + cutting", pricingWarnings(["boxes_only", "foam_insert"], { ...none, corrugated: true }).map((w) => w.href).join() === "/admin/materials,/admin/settings/foam");
check("warnings: complete pack needs foam and boxes", pricingWarnings(["complete_pack"], none).length === 3);
check("warnings: boxes only, no board prices", pricingWarnings(["boxes_only"], none).map((w) => w.href).join() === "/admin/corrugated");
check("warnings: all priced -> none", pricingWarnings(["foam_insert", "complete_pack", "boxes_only"], all).length === 0);

check("page url: demo shop", shopPageUrl("default") === "https://api.alex-io.com/t/default");
check("page url: a shop", shopPageUrl("ashtonne") === "https://ashtonne.api.alex-io.com/");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
