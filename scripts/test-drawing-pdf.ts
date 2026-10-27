// scripts/test-drawing-pdf.ts
//
// Step 44: the 3-view PDF drawing (lib/pdf/threeview.ts): one sheet per part
// plus an assembly sheet for sets, touching / overlapping pockets drawn as one
// merged outline (like the DXF), floor steps and through-cuts, the hidden
// depth profile for the side views, and inch fractions.
// Run: npm run test:drawing-pdf

import { PDFDocument } from "pdf-lib";
import { generate3ViewPDF, fmtIn, threeviewInternals, type Cavity3D, type Drawing3DInput } from "../lib/pdf/threeview";

const { partData, depthProfile } = threeviewInternals;

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

const L = 9.875;
const W = 9.875;
const rect = (id: string, x: number, y: number, l: number, w: number, depth: number): Cavity3D => ({
  id, shape: "rect", x: x / L, y: y / W, lengthIn: l, widthIn: w, depthIn: depth,
});
const circ = (id: string, cx: number, cy: number, d: number, depth: number): Cavity3D => ({
  id, shape: "circle", x: (cx - d / 2) / L, y: (cy - d / 2) / W, lengthIn: d, widthIn: d, diameterIn: d, depthIn: depth,
});

// The quote from the screenshots: a 5 x 5 pocket with a 1" finger slot cut into each side
const pocketSet: Drawing3DInput = {
  quoteNo: "Q-TEST-1",
  customerName: "Test",
  shopName: "Test Foam Co",
  block: { lengthIn: L, widthIn: W, heightIn: 3 },
  layers: [
    { id: "l1", label: "Bottom", thicknessIn: 2, materialName: "1.7# PE", cavities: [rect("a", 2.4375, 2.4375, 5, 5, 1), circ("b", 2.4375, 4.9375, 1, 1), circ("c", 7.4375, 4.9375, 1, 1)] },
    { id: "l2", label: "Top pad", thicknessIn: 1, materialName: "1.7# PE", cavities: [], cropCorners: true },
  ],
};

(async () => {
  // fractions
  check("fmtIn 9.875 -> 9 7/8\"", fmtIn(9.875) === '9 7/8"', fmtIn(9.875));
  check("fmtIn 0.5 -> 1/2\"", fmtIn(0.5) === '1/2"', fmtIn(0.5));
  check("fmtIn 2 -> 2\"", fmtIn(2) === '2"', fmtIn(2));
  check("fmtIn 1.0625 -> 1 1/16\"", fmtIn(1.0625) === '1 1/16"', fmtIn(1.0625));
  check("fmtIn 1.23 -> decimals", fmtIn(1.23) === '1.23"', fmtIn(1.23));

  // overlapping pockets merge: no outline piece runs through the slot openings
  const bottom = partData(pocketSet.block, pocketSet.layers[0]);
  check("bottom part: three schedule rows", bottom.rows.length === 3, bottom.rows.length);
  check("bottom part: rows numbered 1..3", bottom.rows.map((r) => r.n).join(",") === "1,2,3");
  const crossesSlot = bottom.pieces.some(
    (p) => p.t === "line" && near(p.x1, 2.4375) && near(p.x2, 2.4375) && Math.min(p.y1, p.y2) < 4.9375 && Math.max(p.y1, p.y2) > 4.9375,
  );
  check("merged outline: the pocket's left edge stops at the slot", !crossesSlot);
  const arcs = bottom.pieces.filter((p) => p.t === "arc");
  check("merged outline: each slot is an outside half-arc", arcs.length === 2 && arcs.every((a) => a.t === "arc" && near(Math.abs(a.a1 - a.a0), Math.PI, 1e-3)), arcs);
  check("merged outline: all cut edges (one depth)", bottom.pieces.every((p) => p.layer === "cut"));
  check("pocket center X / Y from the lower-left", near(bottom.rows[0].cx, 4.9375) && near(bottom.rows[0].cy, 4.9375), bottom.rows[0]);

  // depth profile for the front view: one 1" run across the pocket and both slots
  const prof = depthProfile(bottom, "x");
  check("front profile: one run 1 15/16 .. 7 15/16 at 1\"", prof.length === 1 && near(prof[0].a, 1.9375) && near(prof[0].b, 7.9375) && near(prof[0].d, 1), prof);

  // step-down + through-cut
  const step = partData(
    { lengthIn: 12, widthIn: 8, heightIn: 2 },
    {
      id: "s", thicknessIn: 2, cavities: [
        { id: "o", shape: "rect", x: 1 / 12, y: 1 / 8, lengthIn: 6, widthIn: 4, depthIn: 0.75 },
        { id: "i", shape: "rect", x: 2 / 12, y: 2 / 8, lengthIn: 3, widthIn: 2, depthIn: 1.5 },
        { id: "t", shape: "circle", x: 8.5 / 12, y: 2 / 8, lengthIn: 2, widthIn: 2, diameterIn: 2, depthIn: 5 },
      ],
    },
  );
  check("step: the inner pocket's edges are floor steps (depth)", step.pieces.some((p) => p.layer === "depth"));
  check("through: the hole is a through-cut", step.pieces.some((p) => p.layer === "through") && step.rows[2].through);
  check("through: depth is capped at the part's thickness", near(step.rows[2].depth, 2));
  const sp = depthProfile(step, "x");
  check("step profile: 3/4, 1 1/2, 3/4, then the 2\" hole", sp.map((r) => r.d).join(",") === "0.75,1.5,0.75,2", sp);

  // sheets: one per part + the assembly; a single part is one sheet
  const setPdf = await PDFDocument.load(await generate3ViewPDF(pocketSet));
  check("set of 2 parts: 3 sheets", setPdf.getPageCount() === 3, setPdf.getPageCount());
  const pg = setPdf.getPage(0);
  check("sheets are 11 x 8.5 landscape", near(pg.getWidth(), 792) && near(pg.getHeight(), 612));
  const one = await PDFDocument.load(await generate3ViewPDF({ ...pocketSet, shopName: undefined, layers: [pocketSet.layers[0]] }));
  check("single part: 1 sheet", one.getPageCount() === 1, one.getPageCount());

  // odd input never throws
  const many: Cavity3D[] = [];
  for (let i = 0; i < 40; i++) many.push(rect(`m${i}`, 0.25 + (i % 8) * 1.2, 0.25 + Math.floor(i / 8) * 1.9, 1, 1.5, 0.5));
  let ok = true;
  try {
    await generate3ViewPDF({ quoteNo: "Q", block: { lengthIn: 10, widthIn: 10, heightIn: 1 }, layers: [{ id: "x", thicknessIn: 1, cavities: many }] });
    await generate3ViewPDF({ quoteNo: "Q", block: { lengthIn: 48, widthIn: 3, heightIn: 4, roundCorners: true, roundRadiusIn: 0.5 }, layers: [{ id: "x", thicknessIn: 4, roundCorners: true, roundRadiusIn: 0.5, cavities: [] }] });
    await generate3ViewPDF({
      quoteNo: "Q", block: { lengthIn: 6, widthIn: 6, heightIn: 1 },
      layers: [{ id: "x", thicknessIn: 1, cavities: [{ id: "p", shape: "poly", x: 0, y: 0, lengthIn: 2, widthIn: 2, depthIn: 0.5, points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.4, y: 0.6 }] }] }],
    });
  } catch (e) {
    ok = false;
    console.log(e);
  }
  check("40 pockets, a long rounded part and a shape pocket all draw", ok);

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})();
