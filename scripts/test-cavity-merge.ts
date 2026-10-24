// scripts/test-cavity-merge.ts
//
// Step 39U: touching / overlapping cavities are one pocket in the DXF / STEP
// (app/lib/layout/cavity-merge.ts, app/lib/layout/layer-dxf.ts).
// Run: npm run test:cavity-merge   (= npx --yes tsx scripts/test-cavity-merge.ts)

import { filterJoinedStepWarnings, joinLayoutCavities, joinTouchingCavities, mergeCavityOutlines, type CavityRegion, type OutlinePiece } from "../app/lib/layout/cavity-merge";
import { buildDxfForLayer, mergedCavitySvg } from "../app/lib/layout/layer-dxf";
import { sheetLayout } from "../app/lib/job-ticket-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const desc = (ps: OutlinePiece[]) =>
  ps
    .map((p) =>
      p.t === "line"
        ? `${p.layer} L ${r2(p.x1)},${r2(p.y1)}>${r2(p.x2)},${r2(p.y2)}`
        : `${p.layer} A ${r2(p.cx)},${r2(p.cy)} r${r2(p.r)} ${Math.round((p.a0 * 180) / Math.PI)}-${Math.round((p.a1 * 180) / Math.PI)}`,
    )
    .sort();
const lenOf = (ps: OutlinePiece[], layer: "cut" | "depth" | "through") =>
  r2(ps.filter((p) => p.layer === layer).reduce((n, p) => n + (p.t === "line" ? Math.hypot(p.x2 - p.x1, p.y2 - p.y1) : p.r * (p.a1 - p.a0)), 0));

// Chuck's insert (Oct 24): main pocket 5 x 5 (2" deep), a 1" step-up touching each side, finger holes on the other two sides
const main: CavityRegion = { kind: "rect", x0: 2.5, y0: 2.5, x1: 7.5, y1: 7.5, depth: 2 };
const left: CavityRegion = { kind: "rect", x0: 1.4, y0: 3, x1: 2.5, y1: 7, depth: 1 };
const right: CavityRegion = { kind: "rect", x0: 7.5, y0: 3, x1: 8.6, y1: 7, depth: 1 };
const top: CavityRegion = { kind: "circle", cx: 5, cy: 7.5, r: 0.5, depth: 2 };
const bot: CavityRegion = { kind: "circle", cx: 5, cy: 2.5, r: 0.5, depth: 2 };
const all = [main, left, right, top, bot];
const m = mergeCavityOutlines(all);

check("no line runs inside a pocket at the same depth (no main-pocket line across a finger hole)", m.some((p) => p.t === "line" && p.y1 === 2.5 && p.x1 > 4.5 && p.x1 < 5.5), false);
check("finger holes: only the outer half circle is drawn", desc(m).filter((d) => d.includes(" A ")), ["cut A 5,2.5 r0.5 180-360", "cut A 5,7.5 r0.5 0-180"]);
check("floor steps (main pocket edge inside the step-ups) on DEPTH", desc(m).filter((d) => d.startsWith("depth")), ["depth L 2.5,7>2.5,3", "depth L 7.5,3>7.5,7"]);
check("step-up inner edges (inside the deeper pocket) are gone", m.some((p) => p.t === "line" && p.layer === "cut" && ((p.x1 === 2.5 && p.x2 === 2.5 && Math.min(p.y1, p.y2) >= 3 && Math.max(p.y1, p.y2) <= 7) || (p.x1 === 7.5 && p.x2 === 7.5 && Math.min(p.y1, p.y2) >= 3 && Math.max(p.y1, p.y2) <= 7))), false);
check("outline length = the merged pocket's perimeter", lenOf(m, "cut"), r2(2 * (2 + 2) + 4 * 0.5 + 2 * (1.1 * 2 + 4) + Math.PI * 0.5 * 2));
check("one sheet cut by all of them = outline only, no DEPTH lines", mergeCavityOutlines(all.map((r) => ({ ...r, depth: 1 }))).filter((p) => p.layer === "depth").length, 0);

// Inset by hand (overlapping 0.25") gives the same drawing
const inset = mergeCavityOutlines([main, { ...left, x1: 2.75 }, { ...right, x0: 7.25 }, top, bot]);
check("overlapped by hand = same lines as touching", desc(inset), desc(m));

// Rounded corners and two equal pockets side by side
const rr = mergeCavityOutlines([
  { kind: "rrect", x0: 0, y0: 0, x1: 4, y1: 2, r: 0.5, depth: 1 },
  { kind: "rrect", x0: 3.5, y0: 0, x1: 7.5, y1: 2, r: 0.5, depth: 1 },
]);
check("two overlapping rounded pockets: no DEPTH, nothing inside", [rr.filter((p) => p.layer === "depth").length, rr.every((p) => p.t !== "line" || !(p.x1 > 0.1 && p.x1 < 7.4 && p.x2 > 0.1 && p.x2 < 7.4 && p.x1 === p.x2))], [0, true]);
check("a lone cavity is unchanged (4 lines)", mergeCavityOutlines([{ kind: "rect", x0: 1, y0: 1, x1: 2, y1: 2, depth: 1 }]).length, 4);
check("a pocket inside a pocket (deeper): inner outline is all DEPTH", desc(mergeCavityOutlines([{ kind: "rect", x0: 0, y0: 0, x1: 4, y1: 4, depth: 1 }, { kind: "rect", x0: 1, y0: 1, x1: 3, y1: 3, depth: 2 }])).filter((d) => d.startsWith("depth")).length, 4);
check("a shallower pocket inside a deeper one disappears", mergeCavityOutlines([{ kind: "rect", x0: 0, y0: 0, x1: 4, y1: 4, depth: 2 }, { kind: "rect", x0: 1, y0: 1, x1: 3, y1: 3, depth: 1 }]).length, 4);

// Joining touching cavities (layout level: x / y are fractions of the block, top-left)
const j = joinTouchingCavities(
  [
    { x: 0.25, y: 0.25, lengthIn: 5, widthIn: 5, depthIn: 2 },
    { x: 0.14, y: 0.3, lengthIn: 1.09, widthIn: 4, depthIn: 1 }, // 0.01" short of the main pocket
    { x: 0.752, y: 0.3, lengthIn: 1.1, widthIn: 4, depthIn: 1 }, // 0.02" away
    { x: 0.1, y: 0.02, lengthIn: 1, widthIn: 1, depthIn: 1 }, // 0.5" away: left alone
  ],
  10,
  10,
);
check("join: the shallow step-ups are stretched 0.01\" into the main pocket", j.map((c) => [r2(c.x * 10 * 100) / 100, r2(c.lengthIn)]), [[2.5, 5], [1.4, 1.11], [7.49, 1.13], [1, 1]]);
check("join: the deeper pocket doesn't move", j[0], { x: 0.25, y: 0.25, lengthIn: 5, widthIn: 5, depthIn: 2 });
check("join: 0.05\" apart is a real wall, not joined", joinTouchingCavities([{ x: 0, y: 0, lengthIn: 1, widthIn: 1, depthIn: 1 }, { x: 0.105, y: 0, lengthIn: 1, widthIn: 1, depthIn: 1 }], 10, 10)[1].x, 0.105);
check("join: circles are left alone", joinTouchingCavities([{ x: 0, y: 0, lengthIn: 1, widthIn: 1, depthIn: 1 }, { x: 0.1, y: 0, lengthIn: 1, widthIn: 1, shape: "circle" }], 10, 10)[1].x, 0.1);
const lay = { block: { lengthIn: 10, widthIn: 10, thicknessIn: 3 }, stack: [{ thicknessIn: 3, cavities: [{ x: 0.25, y: 0.25, lengthIn: 5, widthIn: 5, depthIn: 2 }, { x: 0.14, y: 0.3, lengthIn: 1.1, widthIn: 4, depthIn: 1 }] }] };
const joined = joinLayoutCavities(lay);
check("joinLayoutCavities: copy, original unchanged", [lay.stack[0].cavities[1].lengthIn, r2((joined.stack[0].cavities[1] as { lengthIn: number }).lengthIn)], [1.1, 1.11]);

// The real DXF for the layer
const layout = {
  block: { lengthIn: 10, widthIn: 10, thicknessIn: 3 },
  stack: [
    {
      thicknessIn: 3,
      cavities: [
        { x: 0.25, y: 0.25, lengthIn: 5, widthIn: 5, depthIn: 2 },
        { x: 0.14, y: 0.3, lengthIn: 1.1, widthIn: 4, depthIn: 1 },
        { x: 0.75, y: 0.3, lengthIn: 1.1, widthIn: 4, depthIn: 1 },
        { x: 0.45, y: 0.2, lengthIn: 1, widthIn: 1, depthIn: 2, shape: "circle", diameterIn: 1 },
        { x: 0.45, y: 0.7, lengthIn: 1, widthIn: 1, depthIn: 2, shape: "circle", diameterIn: 1 },
      ],
    },
  ],
};
const dxf = buildDxfForLayer(layout, 0) || "";
const ents = (kind: string, layer?: string) =>
  dxf.split("\n").filter((l, i, a) => l === kind && a[i - 1] === "0" && (layer == null || a[i + 2] === layer)).length;
check("DXF: finger holes are ARCs, not full CIRCLEs", [ents("ARC"), ents("CIRCLE")], [2, 0]);
check("DXF: 2 DEPTH lines (blue)", [ents("LINE", "DEPTH"), dxf.includes("8\nDEPTH\n62\n5")], [2, true]);
check("DXF: block outline + merged pocket on layer 0", ents("LINE", "0"), 4 + 4 + 4 + 2 * 3);
const sheet = buildDxfForLayer(sheetLayout(layout, { layer_index: 0, cavity_index: [0, 1, 2, 3, 4] })!, 0) || "";
check("sheet cut file (all through): no DEPTH lines", sheet.includes("DEPTH"), false);
const lone = buildDxfForLayer({ block: { lengthIn: 10, widthIn: 10 }, stack: [{ thicknessIn: 2, cavities: [{ x: 0.1, y: 0.1, lengthIn: 2, widthIn: 2, depthIn: 1 }, { x: 0.5, y: 0.5, lengthIn: 1, widthIn: 1, shape: "circle", diameterIn: 1, depthIn: 1 }] }] }, 0) || "";
check("DXF: cavities that don't touch are drawn as before (CIRCLE kept)", [lone.split("\n").filter((l, i, a) => l === "CIRCLE" && a[i - 1] === "0").length, lone.includes("DEPTH")], [1, false]);

// Through cuts in the pocket floor (room for a protrusion under the product): own THROUGH layer in the part file
const throughLayout = {
  block: { lengthIn: 10, widthIn: 10, thicknessIn: 3 },
  stack: [
    {
      thicknessIn: 3,
      cavities: [
        ...layout.stack[0].cavities,
        { x: 0.4, y: 0.4, lengthIn: 2, widthIn: 1.5, depthIn: 3 }, // through slot in the main pocket floor
        { x: 0.3, y: 0.55, lengthIn: 0.75, widthIn: 0.75, depthIn: 3, shape: "circle", diameterIn: 0.75 }, // round through hole
      ],
    },
  ],
};
const tdxf = buildDxfForLayer(throughLayout, 0) || "";
const tEnts = (kind: string, layer: string) => tdxf.split("\n").filter((l, i, a) => l === kind && a[i - 1] === "0" && a[i + 2] === layer).length;
check("through: slot (4 lines) + hole (CIRCLE) on THROUGH, magenta", [tEnts("LINE", "THROUGH"), tEnts("CIRCLE", "THROUGH"), tdxf.includes("8\nTHROUGH\n62\n6")], [4, 1, true]);
check("through: the 2 step-up floor lines stay on DEPTH", tEnts("LINE", "DEPTH"), 2);
check("through: joining leaves cavities inside the pocket alone", JSON.stringify(joinLayoutCavities(throughLayout).stack[0].cavities.slice(5)), JSON.stringify(throughLayout.stack[0].cavities.slice(5)));
const bottomSheet = buildDxfForLayer(sheetLayout(throughLayout, { layer_index: 0, cavity_index: [5, 6] })!, 0) || "";
check("through: the bottom sheet's cut file = slot + hole on layer 0, no THROUGH / DEPTH", [bottomSheet.includes("THROUGH"), bottomSheet.includes("DEPTH"), bottomSheet.split("\n").filter((l, i, a) => l === "CIRCLE" && a[i - 1] === "0").length], [false, false, 1]);
const topSheet = buildDxfForLayer(sheetLayout(throughLayout, { layer_index: 0, cavity_index: [0, 1, 2, 3, 4, 5, 6] })!, 0) || "";
check("through: the top sheet's cut file doesn't draw the slot / hole (already open there)", [topSheet.includes("THROUGH"), topSheet.split("\n").filter((l, i, a) => l === "CIRCLE" && a[i - 1] === "0").length], [false, 0]);
const loneThrough = buildDxfForLayer({ block: { lengthIn: 10, widthIn: 10 }, stack: [{ thicknessIn: 2, cavities: [{ x: 0.1, y: 0.1, lengthIn: 2, widthIn: 2, depthIn: 2 }, { x: 0.5, y: 0.5, lengthIn: 1, widthIn: 1, depthIn: 1 }] }] }, 0) || "";
check("through: a lone through cut is on THROUGH too; a lone pocket stays on 0", [loneThrough.split("\n").filter((l, i, a) => l === "LINE" && a[i - 1] === "0" && a[i + 2] === "THROUGH").length, loneThrough.split("\n").filter((l, i, a) => l === "LINE" && a[i - 1] === "0" && a[i + 2] === "0").length], [4, 8]);

// Step 39U2: a finger hole a hair off the pocket edge (live Q-R-261024-44106) is still one arc, not two
const seam = mergeCavityOutlines([
  { kind: "rect", x0: 2.4387, y0: 2.4387, x1: 7.4387, y1: 7.4387, depth: 1 },
  { kind: "circle", cx: 4.9397, cy: 7.4415, r: 0.5, depth: 1 },
]).filter((p) => p.t === "arc");
check("seam: one arc across 0 degrees, a bit over half the circle", [seam.length, seam.length === 1 && seam[0].t === "arc" ? r2(((seam[0].a1 - seam[0].a0) * 180) / Math.PI) : null], [1, 180.64]);

// Step 39V: the STEP service's thin-wall warnings for joined pairs are dropped; real thin walls stay
const live = [
  "Bottom Insert cavity[0] and cavity[1] are -0.4997in apart, thinner than the minimum 0.125in guard Bottom Insert cavity[0] and cavity[2] are -0.4977in apart, thinner than the minimum 0.125in guard Bottom Insert cavity[0] and cavity[3] are 0.0000in apart, thinner than the minimum 0.125in guard Bottom Insert cavity[0] and cavity[4] are 0.0000in apart, thinner than the minimum 0.125in guard",
];
check("STEP warnings: Chuck's 4 joined pairs = no warning", filterJoinedStepWarnings(live), []);
check(
  "STEP warnings: a real 0.06in wall is kept",
  filterJoinedStepWarnings(["Bottom Insert cavity[0] and cavity[3] are 0.0000in apart, thinner than the minimum 0.125in guard Part cavity[1] and cavity[2] are 0.0600in apart, thinner than the minimum 0.125in guard"]),
  ["Part cavity[1] and cavity[2] are 0.0600in apart, thinner than the minimum 0.125in guard"],
);
check("STEP warnings: other messages pass through", filterJoinedStepWarnings(["Something else"]), ["Something else"]);

// Step 39V: the part preview draws what the DXF draws
const live44106 = {
  block: { lengthIn: 9.875, widthIn: 9.875, thicknessIn: 3 },
  stack: [
    {
      thicknessIn: 3,
      cavities: [
        { x: 2.438 / 9.875, y: 2.438 / 9.875, lengthIn: 5, widthIn: 5, depthIn: 1 },
        { x: 4.438 / 9.875, y: 1.938 / 9.875, lengthIn: 1, widthIn: 1, depthIn: 1, shape: "circle", diameterIn: 1 },
        { x: 4.438 / 9.875, y: 6.938 / 9.875, lengthIn: 1, widthIn: 1, depthIn: 1, shape: "circle", diameterIn: 1 },
        { x: 1.438 / 9.875, y: 2.937 / 9.875, lengthIn: 1.125, widthIn: 4, depthIn: 0.5 },
        { x: 7.312 / 9.875, y: 2.937 / 9.875, lengthIn: 1.125, widthIn: 4, depthIn: 0.5 },
      ],
    },
  ],
};
const svg = mergedCavitySvg(live44106, 0, { cut: "#ef4444", strokeWidth: 0.03 }) || "";
const tags = (t: string, piece?: string) => (svg.match(new RegExp(`<${t} [^>]*${piece ? `data-piece="${piece}"` : ""}`, "g")) || []).length;
check("preview: no rects or full circles, 2 finger-hole arcs", [tags("rect"), tags("circle"), tags("path", "cut")], [0, 0, 2]);
check("preview: 2 dashed blue floor-step lines, outline lines in the cavity color", [tags("line", "depth"), svg.includes('stroke="#2563eb"') && svg.includes("stroke-dasharray"), tags("line", "cut")], [2, true, 14]);
check("preview: lone cavities = null (drawn as before)", mergedCavitySvg({ block: { lengthIn: 10, widthIn: 10 }, stack: [{ thicknessIn: 2, cavities: [{ x: 0.1, y: 0.1, lengthIn: 2, widthIn: 2, depthIn: 1 }] }] }, 0, { cut: "red", strokeWidth: 0.03 }), null);

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
