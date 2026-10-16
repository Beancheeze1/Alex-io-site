// scripts/test-dxf.ts
//
// Step 37A2: tests for the in-process DXF reader (lib/dxf/parse.ts) and the
// upload wrapper (lib/dxf/upload.ts). Builds small DXF files in memory.
// Run: npm run test:dxf   (= npx --yes tsx scripts/test-dxf.ts)

import { arcPoints, buildLoops, dxfToFaces, parseDxf, signedArea, unitsFactor } from "../lib/dxf/parse";
import { dxfFacesForUpload } from "../lib/dxf/upload";
import { facesJsonToLayoutSeed } from "../lib/forgeFacesSeed";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

// ---- tiny DXF writer
type E = (string | number)[];
function dxf(entities: E[], opts: { insunits?: number; blocks?: { name: string; base?: [number, number]; ents: E[] }[] } = {}): string {
  const out: (string | number)[] = [];
  out.push(0, "SECTION", 2, "HEADER");
  if (opts.insunits != null) out.push(9, "$INSUNITS", 70, opts.insunits);
  out.push(0, "ENDSEC");
  if (opts.blocks) {
    out.push(0, "SECTION", 2, "BLOCKS");
    for (const b of opts.blocks) {
      out.push(0, "BLOCK", 8, "0", 2, b.name, 70, 0, 10, b.base?.[0] ?? 0, 20, b.base?.[1] ?? 0, 30, 0);
      for (const e of b.ents) out.push(...e);
      out.push(0, "ENDBLK");
    }
    out.push(0, "ENDSEC");
  }
  out.push(0, "SECTION", 2, "ENTITIES");
  for (const e of entities) out.push(...e);
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\n");
}
const line = (x1: number, y1: number, x2: number, y2: number): E => [0, "LINE", 8, "0", 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0];
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, extra: E = []): E => [0, "ARC", 8, "0", 10, cx, 20, cy, 30, 0, 40, r, ...extra, 50, a0, 51, a1];
const circle = (cx: number, cy: number, r: number): E => [0, "CIRCLE", 8, "0", 10, cx, 20, cy, 30, 0, 40, r];
const rect = (x: number, y: number, w: number, h: number): E[] => [line(x, y, x + w, y), line(x + w, y, x + w, y + h), line(x + w, y + h, x, y + h), line(x, y + h, x, y)];
/** Rounded rectangle from LINEs + ARCs (how CAD draws a filleted outline). */
function roundRect(x: number, y: number, w: number, h: number, r: number): E[] {
  return [
    line(x + r, y, x + w - r, y),
    arc(x + w - r, y + r, r, 270, 360),
    line(x + w, y + r, x + w, y + h - r),
    arc(x + w - r, y + h - r, r, 0, 90),
    line(x + w - r, y + h, x + r, y + h),
    arc(x + r, y + h - r, r, 90, 180),
    line(x, y + h - r, x, y + r),
    arc(x + r, y + r, r, 180, 270),
  ];
}
const quiet = <T,>(f: () => T): T => {
  const l = console.log;
  console.log = () => {};
  try {
    return f();
  } finally {
    console.log = l;
  }
};

// ---- units
check("units: inches", unitsFactor(1).f, 1);
check("units: mm", near(unitsFactor(4).f, 1 / 25.4, 1e-9), true);
check("units: missing -> inches", unitsFactor(null).f, 1);
check("units: unknown code -> inches", unitsFactor(99).f, 1);

// ---- arcs
{
  const pts = arcPoints(0, 0, 1, 0, Math.PI / 2, 0.003);
  check("arc: starts at angle 0", near(pts[0].x, 1, 1e-9) && near(pts[0].y, 0, 1e-9), true);
  check("arc: ends at 90", near(pts[pts.length - 1].x, 0, 1e-9) && near(pts[pts.length - 1].y, 1, 1e-9), true);
  check("arc: all on radius", pts.every((p) => near(Math.hypot(p.x, p.y), 1, 1e-9)), true);
  const wrap = arcPoints(0, 0, 1, (350 * Math.PI) / 180, (10 * Math.PI) / 180, 0.003);
  check("arc: wraps through 0 (short way)", wrap.every((p) => p.x > 0.98), true);
}

// ---- lines + arcs make one closed outline (the bug: these came back empty)
{
  const r = dxfToFaces(dxf([...roundRect(0, 0, 10, 8, 0.5)], { insunits: 1 }));
  check("roundRect: 1 insert", r.inserts.length, 1);
  check("roundRect: 1 loop", r.inserts[0]?.loopsCount, 1);
  check("roundRect: outline ccw (+)", (r.inserts[0]?.loops[0].area ?? 0) > 0, true);
  check("roundRect: area ~ 80 - corners", near(r.inserts[0]?.loops[0].area ?? 0, 80 - (4 - Math.PI) * 0.25, 0.02), true);
  check("roundRect: size", `${r.inserts[0]?.insert.lengthIn}x${r.inserts[0]?.insert.widthIn}`, "10x8");
  check("roundRect: no open chains", r.stats.openChains, 0);
}

// ---- outline + cavities + island: signs alternate by nesting
{
  const r = dxfToFaces(
    dxf([...rect(0, 0, 12, 10), ...roundRect(1, 1, 5, 4, 0.25), circle(9, 7, 1), ...rect(2, 2, 1, 1)], { insunits: 1 }),
  );
  const f = r.inserts[0];
  check("nest: 1 insert", r.inserts.length, 1);
  check("nest: 4 loops", f?.loopsCount, 4);
  check("nest: outer is index 0", f?.outerLoopIndex, 0);
  check("nest: outer +", (f?.loops[0].area ?? 0) > 0, true);
  const neg = f?.loops.filter((l) => l.area < 0).length;
  const pos = f?.loops.filter((l) => l.area > 0).length;
  check("nest: 2 cavities (-)", neg, 2);
  check("nest: outer + island (+)", pos, 2);
  const seed = quiet(() => facesJsonToLayoutSeed(f));
  check("nest: seed block length", seed.block.lengthIn, 12);
  check("nest: seed block width", seed.block.widthIn, 10);
  check("nest: seed has 2 top-level cavities", seed.cavities.length, 2);
  check("nest: circle seen as circle", seed.cavities.some((c) => c.shape === "circle" && near(c.lengthIn, 2, 0.07)), true);
}

// ---- clockwise drawing order is fixed up
{
  const cw: E[] = [line(0, 0, 0, 5), line(0, 5, 5, 5), line(5, 5, 5, 0), line(5, 0, 0, 0)];
  const r = dxfToFaces(dxf(cw));
  check("cw: outline turned +", (r.inserts[0]?.loops[0].area ?? 0) > 0, true);
}

// ---- hairline gaps close; real gaps don't
{
  const gap: E[] = [line(0, 0, 4, 0), line(4.002, 0, 4, 4), line(4, 4, 0, 4), line(0, 4, 0, 0.001)];
  check("gap: 0.002in closes", dxfToFaces(dxf(gap)).inserts.length, 1);
  const open: E[] = [line(0, 0, 4, 0), line(4, 0, 4, 4), line(4, 4, 0, 4), line(0, 4, 0, 0.5)];
  const r = dxfToFaces(dxf(open));
  check("gap: 0.5in stays open", r.inserts.length, 0);
  check("gap: open chain counted", r.stats.openChains, 1);
  check("gap: warning given", r.warnings.length >= 1, true);
}

// ---- duplicate lines are ignored
{
  const r = dxfToFaces(dxf([...rect(0, 0, 3, 3), ...rect(0, 0, 3, 3)]));
  check("dupes: still 1 loop", r.inserts[0]?.loopsCount, 1);
}

// ---- LWPOLYLINE with bulges (a 4x2 slot: two straight sides, two half circles)
{
  const slot: E = [0, "LWPOLYLINE", 8, "0", 90, 4, 70, 1, 10, 1, 20, 0, 10, 3, 20, 0, 42, 1, 10, 3, 20, 2, 10, 1, 20, 2, 42, 1];
  const r = dxfToFaces(dxf([slot]));
  const f = r.inserts[0];
  check("bulge: 1 loop", f?.loopsCount, 1);
  check("bulge: width 4", near(f?.insert.lengthIn ?? 0, 4, 0.01), true);
  check("bulge: height 2", near(f?.insert.widthIn ?? 0, 2, 0.01), true);
  check("bulge: area 2x2 + pi", near(Math.abs(f?.loops[0].area ?? 0), 4 + Math.PI, 0.02), true);
  const neg: E = [0, "LWPOLYLINE", 8, "0", 90, 4, 70, 1, 10, 1, 20, 0, 42, -1, 10, 3, 20, 0, 10, 3, 20, 2, 42, -1, 10, 1, 20, 2];
  const r2 = dxfToFaces(dxf([neg]));
  check("bulge: negative bulge bows inward (area 4 - pi)", near(Math.abs(r2.inserts[0]?.loops[0].area ?? 0), 4 - Math.PI, 0.02), true);
}

// ---- old-style POLYLINE / VERTEX
{
  const pl: E = [0, "POLYLINE", 8, "0", 66, 1, 70, 1, 0, "VERTEX", 8, "0", 10, 0, 20, 0, 0, "VERTEX", 8, "0", 10, 6, 20, 0, 0, "VERTEX", 8, "0", 10, 6, 20, 3, 0, "VERTEX", 8, "0", 10, 0, 20, 3, 0, "SEQEND"];
  const r = dxfToFaces(dxf([pl]));
  check("polyline: area 18", near(Math.abs(r.inserts[0]?.loops[0].area ?? 0), 18, 1e-6), true);
}

// ---- ELLIPSE (full) inside a rect
{
  const el: E = [0, "ELLIPSE", 8, "0", 10, 5, 20, 5, 30, 0, 11, 2, 21, 0, 31, 0, 40, 0.5, 41, 0, 42, Math.PI * 2];
  const r = dxfToFaces(dxf([...rect(0, 0, 10, 10), el]));
  const cav = r.inserts[0]?.loops.find((l) => l.area < 0);
  check("ellipse: cavity area pi*2*1", near(Math.abs(cav?.area ?? 0), Math.PI * 2, 0.03), true);
}

// ---- SPLINE (closed, clamped cubic through a square's corners -> closed loop)
{
  const ctrl = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const knots = [0, 0, 0, 0, 0.5, 1, 1, 1, 1];
  const sp: E = [0, "SPLINE", 8, "0", 70, 0, 71, 3, 72, knots.length, 73, ctrl.length];
  for (const k of knots) sp.push(40, k);
  for (const [x, y] of ctrl) sp.push(10, x, 20, y, 30, 0);
  const pts = parseDxf(dxf([sp])).segments;
  check("spline: starts at first control point", near(pts[0].x1, 0, 1e-9) && near(pts[0].y1, 0, 1e-9), true);
  check("spline: ends at last control point", near(pts[pts.length - 1].x2, 0, 1e-9) && near(pts[pts.length - 1].y2, 0, 1e-9), true);
  check("spline: closes into a loop", buildLoops(pts).loops.length, 1);
}

// ---- mm drawing is converted to inches
{
  const r = dxfToFaces(dxf(rect(0, 0, 254, 127), { insunits: 4 }));
  check("mm: 254mm -> 10in", r.inserts[0]?.insert.lengthIn, 10);
  check("mm: 127mm -> 5in", r.inserts[0]?.insert.widthIn, 5);
  check("mm: units label", r.stats.unitsLabel, "mm");
}

// ---- mirrored arc (extrusion 0,0,-1)
{
  const a = dxfToFaces(dxf([arc(2, 0, 1, 90, 270, [210, 0, 220, 0, 230, -1]), line(-2, 1, -2, -1)]));
  // OCS mirror: center x -> -2, so the half circle bulges right of x=-2... the
  // line closes it at x = -2
  check("ocs: mirrored arc closes with line at x=-2", a.inserts.length, 1);
}

// ---- INSERT (block placed twice, scaled + moved)
{
  const r = dxfToFaces(
    dxf([[0, "INSERT", 8, "0", 2, "PAD", 10, 0, 20, 0, 30, 0], [0, "INSERT", 8, "0", 2, "PAD", 10, 20, 20, 0, 30, 0, 41, 2, 42, 2]], {
      blocks: [{ name: "PAD", ents: rect(0, 0, 5, 4) }],
    }),
  );
  check("insert: 2 inserts", r.inserts.length, 2);
  check("insert: second scaled x2", r.inserts[1]?.insert.lengthIn, 10);
}

// ---- several inserts: ordered left to right, each with its own cavities
{
  const r = dxfToFaces(dxf([...rect(30, 0, 8, 8), circle(34, 4, 1), ...rect(0, 0, 8, 8), ...rect(15, 0, 8, 8), ...rect(16, 1, 2, 2), ...rect(19, 1, 2, 2)]));
  check("multi: 3 inserts", r.inserts.length, 3);
  check("multi: left first", r.inserts.map((i) => i.loopsCount).join(","), "1,3,2");
  check("multi: index/count", `${r.inserts[2]?.insert.index}/${r.inserts[2]?.insert.count}`, "2/3");
}

// ---- tiny stray shapes are not inserts; text etc. ignored
{
  const txt: E = [0, "TEXT", 8, "0", 10, 0, 20, 0, 40, 0.2, 1, "PART A"];
  const r = dxfToFaces(dxf([...rect(0, 0, 6, 6), ...rect(20, 20, 0.2, 0.2), txt]));
  check("stray: tiny shape dropped", r.inserts.length, 1);
  check("stray: text counted, not drawn", r.stats.entities.TEXT, 1);
}

// ---- upload wrapper
{
  const ok = dxfFacesForUpload(Buffer.from(dxf([...rect(0, 0, 6, 6), ...rect(10, 0, 6, 6)])));
  check("upload: ok", ok.ok, true);
  if (ok.ok) {
    check("upload: top level = first insert", ok.faces.loopsCount, 1);
    check("upload: inserts listed", ok.faces.inserts?.length, 2);
    check("upload: source dxf", ok.faces.source, "dxf");
  }
  const one = dxfFacesForUpload(Buffer.from(dxf(rect(0, 0, 6, 6))));
  check("upload: single insert has no list", one.ok && one.faces.inserts === undefined, true);
  const bin = dxfFacesForUpload(Buffer.from("AutoCAD Binary DXF\r\n\x1a\x00junk"));
  check("upload: binary refused", !bin.ok && /binary/i.test(bin.message), true);
  const none = dxfFacesForUpload(Buffer.from(dxf([line(0, 0, 1, 1)])));
  check("upload: no outline message", !none.ok && /closed outline/.test(none.message), true);
  check("upload: empty refused", dxfFacesForUpload(Buffer.alloc(0)).ok, false);
}

// ---- signed area helper
check("signedArea: ccw +", signedArea([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]) > 0, true);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
