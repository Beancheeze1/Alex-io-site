// scripts/test-reorder.ts
//
// Step 34B: tests for the reorder and saved-address rules (app/lib/reorder-core.ts).
// Run: npm run test:reorder   (= npx --yes tsx scripts/test-reorder.ts)

import { addressKey, cleanReorderInput, factsFoam, itemQty, reorderFacts, savedAddresses } from "../app/lib/reorder-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const show = (r: ReturnType<typeof cleanReorderInput>) =>
  r.ok ? `foam=${r.value.foamQty} boxes=${r.value.boxes.map((b) => `${b.id}:${b.qty}`).join(",")} art=${r.value.artworkChanged}` : `ERR ${r.field}`;

const both = { foamSets: 250, boxes: [{ id: 11, qty: 250 }, { id: 12, qty: 500 }] };
const foamOnly = { foamSets: 50, boxes: [] };
const boxesOnly = { foamSets: null, boxes: [{ id: 21, qty: 300 }] };

// input
check("defaults keep the source quantities", show(cleanReorderInput({}, both)), "foam=250 boxes=11:250,12:500 art=false");
check("new quantities", show(cleanReorderInput({ foam_qty: 400, boxes: [{ id: 11, qty: 400 }, { id: 12, qty: "800" }] }, both)), "foam=400 boxes=11:400,12:800 art=false");
check("box line left off with 0", show(cleanReorderInput({ boxes: [{ id: 12, qty: 0 }] }, both)), "foam=250 boxes=11:250,12:0 art=false");
check("artwork changed", show(cleanReorderInput({ artwork_changed: true }, both)), "foam=250 boxes=11:250,12:500 art=true");
check("artwork changed must be true", show(cleanReorderInput({ artwork_changed: "yes" }, both)), "foam=250 boxes=11:250,12:500 art=false");
check("foam 0 refused", show(cleanReorderInput({ foam_qty: 0 }, both)), "ERR foam_qty");
check("foam decimal refused", show(cleanReorderInput({ foam_qty: 2.5 }, both)), "ERR foam_qty");
check("foam too big refused", show(cleanReorderInput({ foam_qty: 1_000_001 }, both)), "ERR foam_qty");
check("foam negative refused", show(cleanReorderInput({ foam_qty: -5 }, both)), "ERR foam_qty");
check("foam junk refused", show(cleanReorderInput({ foam_qty: "abc" }, both)), "ERR foam_qty");
check("box negative refused", show(cleanReorderInput({ boxes: [{ id: 11, qty: -1 }] }, both)), "ERR box_11");
check("box from another order refused", show(cleanReorderInput({ boxes: [{ id: 99, qty: 1 }] }, both)), "ERR boxes");
check("foam only", show(cleanReorderInput({ foam_qty: 75 }, foamOnly)), "foam=75 boxes= art=false");
check("foam_qty ignored without foam", show(cleanReorderInput({ foam_qty: 5 }, boxesOnly)), "foam=null boxes=21:300 art=false");
check("boxes only, all 0 refused", show(cleanReorderInput({ boxes: [{ id: 21, qty: 0 }] }, boxesOnly)), "ERR boxes");
check("boxes only, new qty", show(cleanReorderInput({ boxes: [{ id: 21, qty: 1200 }] }, boxesOnly)), "foam=null boxes=21:1200 art=false");
check("junk body", show(cleanReorderInput(null, both)), "foam=250 boxes=11:250,12:500 art=false");

// facts
const src = {
  dims: "12x10x2",
  qty: 250,
  material_id: 7,
  print_spec: { colors: ["spot"], sides: 1 },
  revision: "B",
  released_rev: "B",
  stage_rev: "BS",
  released_from_stage: "AS",
  stage_pending_bump: true,
  foam_qty_breaks: [100, 250],
  box_qty_breaks: [250],
  price_lock_at: "x",
  reorder_of: "Q-OLD",
  notes: "Black, please",
};
const f = reorderFacts(src, { srcQuoteNo: "Q-A-1", foamQty: 400, artworkChanged: false });
check("facts keep spec", `${f.dims}|${f.material_id}|${JSON.stringify(f.print_spec)}|${f.notes}`, '12x10x2|7|{"colors":["spot"],"sides":1}|Black, please');
check("facts new qty", f.qty, 400);
check("facts drop revisions", ["revision", "released_rev", "stage_rev", "released_from_stage", "stage_pending_bump"].some((k) => k in f), false);
check("facts drop qty breaks", "foam_qty_breaks" in f || "box_qty_breaks" in f, false);
check("facts drop locks", "price_lock_at" in f, false);
check("facts reorder_of", f.reorder_of, "Q-A-1");
check("facts no artwork flag", "reorder_artwork_changed" in f, false);
const f2 = reorderFacts(src, { srcQuoteNo: "Q-A-1", foamQty: null, artworkChanged: true });
check("facts keep qty without foam", f2.qty, 250);
check("facts artwork flag", f2.reorder_artwork_changed, true);
check("facts don't touch the source", src.revision, "B");

// item quantities
check("foam row follows", itemQty({ qty: 250, isPackaging: false }, 250, 400), 400);
check("packaging row that matched follows", itemQty({ qty: 250, isPackaging: true }, 250, 400), 400);
check("packaging row with its own qty stays", itemQty({ qty: 10, isPackaging: true }, 250, 400), 10);
check("no foam: unchanged", itemQty({ qty: 5, isPackaging: false }, null, null), 5);

// foam from facts only (never applied to a layout)
const ff = factsFoam({ dims: "10x8x3", qty: 300, material_id: 4, material_name: "1.7# Black" });
check("facts foam", ff && `${ff.sets}|${ff.label}`, "300|10 x 8 x 3 in, 1.7# Black");
check("facts foam object dims", factsFoam({ dims: { L: 12.5, W: 10, H: 2 }, qty: 5, material_id: 1 })?.label, "12.5 x 10 x 2 in");
check("facts foam boxes-only", factsFoam({ dims: "10x8x3", qty: 300, material_id: 4, pack_type: "boxes_only" }), null);
check("facts foam no material", factsFoam({ dims: "10x8x3", qty: 300 }), null);
check("facts foam no qty", factsFoam({ dims: "10x8x3", material_id: 4 }), null);
check("facts foam bad dims", factsFoam({ dims: "big", qty: 3, material_id: 4 }), null);
check("facts foam none", factsFoam(null), null);

// addresses
const a1 = { name: "Receiving", company: "Acme", line1: "100 Main St", line2: null, city: "Chicago", state: "IL", zip: "60601" };
check("key ignores case and spacing", addressKey(a1) === addressKey({ ...a1, line1: " 100  MAIN st ", city: "CHICAGO" }), true);
check("key uses ZIP5", addressKey(a1) === addressKey({ ...a1, zip: "60601-1234" }), true);
check("key differs by street", addressKey(a1) === addressKey({ ...a1, line1: "200 Main St" }), false);
const list = savedAddresses(
  [
    a1,
    { ...a1, line1: "100 MAIN ST" }, // same address again
    { name: null, company: null, line1: "5 Oak Rd", line2: null, city: "Shelby", state: "OH", zip: "44875" },
    { name: "X", company: null, line1: null, line2: null, city: null, state: null, zip: "" }, // no ZIP
    { name: "Hidden", company: null, line1: "9 Elm", line2: null, city: "Mansfield", state: "OH", zip: "44901" },
  ],
  new Set([addressKey({ line1: "9 Elm", city: "Mansfield", state: "OH", zip: "44901" })]),
);
check("saved: deduped, no-ZIP and hidden left out", list.length, 2);
check("saved: newest first", list[0].line1, "100 Main St");
check("saved: label", list[0].label, "Acme, 100 Main St, Chicago, IL 60601");
check("saved: label without company", list[1].label, "5 Oak Rd, Shelby, OH 44875");
check("saved: max", savedAddresses(Array.from({ length: 20 }, (_, i) => ({ line1: `${i} St`, zip: "60601" })), new Set(), 10).length, 10);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
if (failed) process.exit(1);
