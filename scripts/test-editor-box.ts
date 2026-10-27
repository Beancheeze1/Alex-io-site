// scripts/test-editor-box.ts
//
// Step 44g: the box the layout editor sends with Apply when "Customer box
// (inside)" is filled in (lib/editor-box.ts editorCarton).
// Run: npm run test:editor-box

import { editorCarton } from "../lib/editor-box";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

const revise = { fromStartQuote: false, stockPickedThisSession: false };
const start = { fromStartQuote: true, stockPickedThisSession: false };

// After Revise: no URL box, customer box changed 10x10x3 -> 10x10x4
const a = editorCarton({ L: 10, W: 10, H: 4, style: "mailer" }, undefined, revise);
check("revise: sends the customer box size", a?.inside_length_in === 10 && a?.inside_width_in === 10 && a?.inside_height_in === 4, a);
check("revise: marked editor_box (server uses it only when the quote has a box)", a?.editor_box === true, a);
check("revise: custom sku", a?.sku === "CUSTOM-10x10x4" && a?.style === "mailer", a);

// No customer box: nothing changes
check("no customer box: nothing sent", editorCarton(null, undefined, revise) === null);
check("half-filled customer box: other carton kept", editorCarton({ L: 10, W: 0, H: 4 }, { sku: "S1" }, revise)?.sku === "S1");

// Start Quote custom box, same size: unchanged (keeps the URL's grade)
const url = { style: "MAILER", sku: "CUSTOM-10x10x3", board_grade_id: 7, inside_length_in: 10, inside_width_in: 10, inside_height_in: 3 };
check("start quote, same size: URL carton kept", editorCarton({ L: 10, W: 10, H: 3, style: "mailer" }, url, start) === url);
// Start Quote, size edited in the editor before the first Apply
const b = editorCarton({ L: 12, W: 10, H: 3, style: "mailer" }, url, start);
check("start quote, edited size: new size, grade kept, not editor_box", b?.inside_length_in === 12 && b?.board_grade_id === 7 && b?.editor_box === false, b);
// Style changed only
const c = editorCarton({ L: 10, W: 10, H: 3, style: "rsc" }, url, start);
check("style change counts as a change", c?.style === "rsc" && c?.sku === "CUSTOM-10x10x3", c);

// Stock SKU from Start Quote at the same size stays stock
const stock = { style: "RSC", sku: "RSC-12108", inside_length_in: 12, inside_width_in: 10, inside_height_in: 8 };
check("start quote stock box, same size: stays stock", editorCarton({ L: 12, W: 10, H: 8, style: "rsc" }, stock, start)?.sku === "RSC-12108");

// Stock box picked this session in the editor wins over the customer box
check("stock picked in the editor wins", editorCarton({ L: 20, W: 20, H: 20 }, stock, { fromStartQuote: false, stockPickedThisSession: true })?.sku === "RSC-12108");

// Customer box with no style takes the other carton's style
check("no style: takes the other carton's style", editorCarton({ L: 9, W: 9, H: 9 }, url, start)?.style === "MAILER");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
