// lib/pdf/threeview.ts
//
// CAD-style foam drawing: ONE SHEET PER PART (layer), plus an assembly sheet
// when the set has more than one part.
//
// Step 44 (Chuck, Oct 27): restyled like a shop drawing.
//   - Third-angle views at a true standard scale (1:1, 1:2, 1:4 …, printed
//     on 11 × 8.5 at 100%): TOP view, FRONT view under it, RIGHT view beside
//     the front view. Overall sizes are dimensioned once (L above the top
//     view, W left of it, thickness left of the front view).
//   - Pockets are numbered in the top view (balloons) and listed in a cavity
//     schedule (shape, size, depth, X / Y of the center from the lower-left
//     corner), instead of crowding a dimension next to every pocket.
//   - Touching / overlapping pockets are drawn as one pocket, the same as the
//     DXF (Step 39U: app/lib/layout/cavity-merge.ts): the merged outline, a
//     floor step dashed blue, a through-cut magenta. The side views show the
//     pockets' hidden depth profile, not one dashed box per pocket.
//   - A shaded isometric view of the part.
//   - Parts dimensioned in inches with sixteenths shown as fractions.
//   - Multi-part sets: a last ASSEMBLY sheet with an exploded isometric view
//     and a parts list.
// Public API (generate3ViewPDF and the input types) is unchanged; shopName is
// a new optional field for the title block.

import { PDFDocument, PDFPage, PDFFont, rgb, degrees, StandardFonts, type RGB } from "pdf-lib";
import { partName } from "@/app/lib/foam-terms";
import { joinTouchingCavities, mergeCavityOutlines, type CavityRegion, type OutlinePiece } from "@/app/lib/layout/cavity-merge";
import { cavityRegion, type FlatCavity } from "@/app/lib/layout/layer-dxf";

// ─── Public types ─────────────────────────────────────────────────────────────

export type Block3D = {
  lengthIn:       number;
  widthIn:        number;
  heightIn:       number;
  cornerStyle?:   "square" | "chamfer";
  chamferIn?:     number;
  roundCorners?:  boolean;
  roundRadiusIn?: number;
};

export type Cavity3D = {
  id:              string;
  shape:           "rect" | "circle" | "roundedRect" | "poly";
  x:               number;   // 0-1 from left, normalised to block length
  y:               number;   // 0-1 from top,  normalised to block width
  lengthIn:        number;
  widthIn:         number;
  depthIn:         number;
  cornerRadiusIn?: number;
  diameterIn?:     number;
  points?:         Array<{ x: number; y: number }>;
  nestedCavities?: Array<{ points: Array<{ x: number; y: number }> }>;
  label?:          string;
};

export type Layer3D = {
  id:             string;
  label?:         string;
  thicknessIn:    number;
  materialName?:  string;
  cavities:       Cavity3D[];
  cropCorners?:   boolean;
  roundCorners?:  boolean;
  roundRadiusIn?: number;
};

export type Drawing3DInput = {
  quoteNo:        string;
  customerName?:  string;
  shopName?:      string; // Step 44: the shop's name in the title block
  block:          Block3D;
  layers:         Layer3D[];
  revision?:      string;
  date?:          string;
  notes?:         string[];
};

// ─── Look ─────────────────────────────────────────────────────────────────────

const C = {
  black:    rgb(0, 0, 0),
  white:    rgb(1, 1, 1),
  ink:      rgb(0.12, 0.12, 0.12),
  dim:      rgb(0.25, 0.25, 0.25),
  hidden:   rgb(0.35, 0.35, 0.35),
  muted:    rgb(0.45, 0.45, 0.45),
  foam:     rgb(0.90, 0.90, 0.90),
  rule:     rgb(0.70, 0.70, 0.70),
  header:   rgb(0.88, 0.88, 0.88),
  band:     rgb(0.13, 0.13, 0.13),
  depth:    rgb(0.15, 0.39, 0.92), // floor step (same as the DXF's DEPTH layer)
  through:  rgb(0.75, 0.15, 0.83), // through-cut (THROUGH layer)
  isoTop:   rgb(0.80, 0.80, 0.80),
  isoFront: rgb(0.55, 0.55, 0.55),
  isoRight: rgb(0.42, 0.42, 0.42),
  isoWall:  rgb(0.30, 0.30, 0.30),
  isoFloor: rgb(0.62, 0.62, 0.62),
};

// Page (11 × 8.5 landscape, points)
const PW = 792;
const PH = 612;
const M = 18;               // border margin
const TB_H = 80;            // title block height
const RC_W = 248;           // right column width
const MAIN_X = M;
const MAIN_Y = M + TB_H;
const MAIN_W = PW - 2 * M - RC_W;
const MAIN_H = PH - 2 * M - TB_H;
const RC_X = MAIN_X + MAIN_W;
const BANNER_H = 30;        // Step 44b: the "auto-generated" line across the top of the main area
const AUTO_NOTE = "THIS DRAWING WAS AUTO-GENERATED, SEE STEP AND DXF FILES FOR DETAILS";

// Standard drawing scales (1 : n), smallest n that fits wins
const SCALES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100];

type Pt = { x: number; y: number };
type Fonts = { r: PDFFont; b: PDFFont };

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generate3ViewPDF(input: Drawing3DInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const f: Fonts = {
    r: await pdfDoc.embedFont(StandardFonts.Helvetica),
    b: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const { layers } = input;
  const assembly = layers.length > 1;
  const sheets = layers.length + (assembly ? 1 : 0);
  const date = input.date || new Date().toISOString().split("T")[0];
  const rev = input.revision || "AS";

  for (let li = 0; li < layers.length; li++) {
    const page = pdfDoc.addPage([PW, PH]);
    const part = partData(input.block, layers[li]);
    frame(page);
    autoNote(page, f);
    const scale = orthoViews(page, f, part);
    partPanel(page, f, input, layers[li], li, layers.length);
    isoPanel(page, f, part);
    schedulePanel(page, f, part);
    titleBlock(page, f, {
      input,
      title: assembly ? `${partName(layers[li].label, li).toUpperCase()}` : "FOAM INSERT",
      description: `${fmtIn(input.block.lengthIn)} \xD7 ${fmtIn(input.block.widthIn)} \xD7 ${fmtIn(layers[li].thicknessIn)} ${partName(layers[li].label, li)}`,
      material: layers[li].materialName || "—",
      notes: generalNotes(input, [part]),
      rev,
      date,
      scale: `1:${scale}`,
      sheet: `${li + 1} OF ${sheets}`,
    });
  }

  if (assembly) {
    const page = pdfDoc.addPage([PW, PH]);
    frame(page);
    autoNote(page, f);
    const parts = layers.map((l) => partData(input.block, l));
    assemblyView(page, f, parts);
    bomPanel(page, f, input, parts);
    titleBlock(page, f, {
      input,
      title: "FOAM INSERT ASSEMBLY",
      description: `${layers.length} parts per set, ${fmtIn(input.block.lengthIn)} \xD7 ${fmtIn(input.block.widthIn)} \xD7 ${fmtIn(layers.reduce((s, l) => s + l.thicknessIn, 0))} overall`,
      material: Array.from(new Set(layers.map((l) => l.materialName).filter(Boolean))).join(", ") || "—",
      notes: generalNotes(input, parts),
      rev,
      date,
      scale: "NTS",
      sheet: `${sheets} OF ${sheets}`,
    });
  }

  return Buffer.from(await pdfDoc.save());
}

// ─── Part geometry (inches, plan y up with 0 at the front edge) ───────────────

type CavRow = {
  n: number;
  shape: string;
  size: string;
  depth: number;
  through: boolean;
  cx: number;  // center from the lower-left corner (inches)
  cy: number;
  region: CavityRegion;
};

type PartData = {
  L: number;
  W: number;
  T: number;
  outline: Pt[];          // plan outline, counter-clockwise
  regions: CavityRegion[]; // joined, for drawing
  pieces: OutlinePiece[];  // merged pocket edges (top face)
  rows: CavRow[];          // one per cavity, numbered as in the layout
};

function partData(block: Block3D, layer: Layer3D): PartData {
  const L = block.lengthIn;
  const W = block.widthIn;
  const T = layer.thicknessIn;
  const depthOf = (c: { depthIn?: number }) => (Number(c.depthIn) > 0 ? Math.min(Number(c.depthIn), T) : T);

  const toFlat = (c: Cavity3D): FlatCavity =>
    ({
      shape: c.shape,
      x: c.x,
      y: c.y,
      lengthIn: c.lengthIn,
      widthIn: c.widthIn,
      depthIn: c.depthIn,
      diameterIn: c.diameterIn,
      cornerRadiusIn: c.shape === "roundedRect" ? c.cornerRadiusIn : undefined,
      points: c.points,
    }) as unknown as FlatCavity;

  const joined = joinTouchingCavities(layer.cavities.map((c) => ({ ...c })), L, W, T) as Cavity3D[];
  const regions = joined
    .map((c) => cavityRegion(toFlat(c), L, W, depthOf(c)))
    .filter((r): r is CavityRegion => !!r);
  const pieces = regions.length ? mergeCavityOutlines(regions, { throughAt: T }) : [];

  const rows: CavRow[] = [];
  layer.cavities.forEach((c, i) => {
    const region = cavityRegion(toFlat(c), L, W, depthOf(c));
    if (!region) return;
    const b = regionBox(region);
    const shape =
      c.shape === "circle" ? "ROUND" : c.shape === "roundedRect" ? "RND RECT" : c.shape === "poly" ? "SHAPE" : "RECT";
    const size =
      c.shape === "circle"
        ? `\xD8${fmtIn(c.diameterIn || Math.min(c.lengthIn, c.widthIn))}`
        : `${fmtIn(c.lengthIn)} \xD7 ${fmtIn(c.widthIn)}${c.shape === "roundedRect" && c.cornerRadiusIn ? ` R${fmtIn(c.cornerRadiusIn)}` : ""}`;
    rows.push({
      n: i + 1,
      shape,
      size,
      depth: depthOf(c),
      through: depthOf(c) >= T - 1e-6,
      cx: (b.x0 + b.x1) / 2,
      cy: (b.y0 + b.y1) / 2,
      region,
    });
  });

  return { L, W, T, outline: planOutline(block, layer), regions, pieces, rows };
}

/** Plan outline (CCW): square, the layer's crop corners (front-right and back-left), or rounded. */
function planOutline(block: Block3D, layer: Layer3D): Pt[] {
  const L = block.lengthIn;
  const W = block.widthIn;
  if (layer.roundCorners && layer.roundRadiusIn && layer.roundRadiusIn > 0) {
    const r = Math.min(layer.roundRadiusIn, L / 2, W / 2);
    const pts: Pt[] = [];
    const corners: [number, number, number][] = [
      [L - r, r, -Math.PI / 2],
      [L - r, W - r, 0],
      [r, W - r, Math.PI / 2],
      [r, r, Math.PI],
    ];
    for (const [cx, cy, a0] of corners) {
      for (let s = 0; s <= 8; s++) {
        const a = a0 + (s / 8) * (Math.PI / 2);
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    }
    return pts;
  }
  if (!layer.roundCorners && layer.cropCorners) {
    const c = Math.min(block.chamferIn ?? 1, L / 2, W / 2);
    if (c > 0) {
      // the editor crops the plan's top-left and bottom-right corners
      return [
        { x: 0, y: 0 },
        { x: L - c, y: 0 },
        { x: L, y: c },
        { x: L, y: W },
        { x: c, y: W },
        { x: 0, y: W - c },
      ];
    }
  }
  return [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ];
}

function regionBox(r: CavityRegion): { x0: number; y0: number; x1: number; y1: number } {
  if (r.kind === "circle") return { x0: r.cx - r.r, y0: r.cy - r.r, x1: r.cx + r.r, y1: r.cy + r.r };
  if (r.kind === "poly") {
    const xs = r.pts.map((p) => p.x);
    const ys = r.pts.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  return { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
}

/** A region's outline as points (inches, plan). */
function regionPts(r: CavityRegion, segs = 40): Pt[] {
  if (r.kind === "circle") {
    return Array.from({ length: segs }, (_, i) => {
      const a = (i / segs) * Math.PI * 2;
      return { x: r.cx + r.r * Math.cos(a), y: r.cy + r.r * Math.sin(a) };
    });
  }
  if (r.kind === "poly") return r.pts;
  if (r.kind === "rrect") {
    const rad = Math.max(0, Math.min(r.r, (r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2));
    if (rad <= 0) return rectPts(r.x0, r.y0, r.x1, r.y1);
    const pts: Pt[] = [];
    const corners: [number, number, number][] = [
      [r.x1 - rad, r.y0 + rad, -Math.PI / 2],
      [r.x1 - rad, r.y1 - rad, 0],
      [r.x0 + rad, r.y1 - rad, Math.PI / 2],
      [r.x0 + rad, r.y0 + rad, Math.PI],
    ];
    for (const [cx, cy, a0] of corners) {
      for (let s = 0; s <= 6; s++) {
        const a = a0 + (s / 6) * (Math.PI / 2);
        pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
      }
    }
    return pts;
  }
  return rectPts(r.x0, r.y0, r.x1, r.y1);
}

const rectPts = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// ─── Orthographic views (third angle, true scale) ─────────────────────────────

function orthoViews(page: PDFPage, f: Fonts, p: PartData): number {
  const DIM_L = 36; // room for the W and T dims on the left
  const DIM_T = 30; // room for the L dim above the top view
  const GAP_V = 40; // between the top and front views (holds the TOP VIEW label)
  const GAP_H = 44; // between the front and right views
  const LBL = 24;   // labels under the front / right views
  const PAD = 14;

  const availW = MAIN_W - 2 * PAD - DIM_L - GAP_H;
  const availH = MAIN_H - BANNER_H - 2 * PAD - DIM_T - GAP_V - LBL;
  const fit = Math.min(availW / (p.L + p.W), availH / (p.W + p.T)); // points per inch
  const n = SCALES.find((k) => 72 / k <= fit) ?? Math.ceil(72 / fit);
  const s = 72 / n;

  const groupW = DIM_L + (p.L + p.W) * s + GAP_H;
  const groupH = DIM_T + (p.W + p.T) * s + GAP_V + LBL;
  const gx = MAIN_X + PAD + Math.max(0, (MAIN_W - 2 * PAD - groupW) / 2);
  const gTop = MAIN_Y + MAIN_H - BANNER_H - PAD - Math.max(0, (MAIN_H - BANNER_H - 2 * PAD - groupH) / 2);

  // view origins (lower-left of each view's part, points)
  const topO = { x: gx + DIM_L, y: gTop - DIM_T - p.W * s };
  const frontO = { x: topO.x, y: topO.y - GAP_V - p.T * s };
  const rightO = { x: frontO.x + p.L * s + GAP_H, y: frontO.y };

  topView(page, f, p, topO, s);
  frontView(page, f, p, frontO, s);
  rightView(page, f, p, rightO, s);

  // dims: L above the top view, W left of it, T left of the front view
  hDim(page, f, topO.x, topO.x + p.L * s, topO.y + p.W * s, topO.y + p.W * s + 16, fmtIn(p.L));
  vDim(page, f, topO.y, topO.y + p.W * s, topO.x, topO.x - 18, fmtIn(p.W));
  vDim(page, f, frontO.y, frontO.y + p.T * s, frontO.x, frontO.x - 18, fmtIn(p.T));

  // view labels
  viewLabel(page, f, "TOP VIEW", topO.x + (p.L * s) / 2, topO.y - 16);
  viewLabel(page, f, "FRONT VIEW", frontO.x + (p.L * s) / 2, frontO.y - 16);
  viewLabel(page, f, "RIGHT VIEW", rightO.x + (p.W * s) / 2, rightO.y - 16);

  // projection lines (light) tie the views together
  const proj = { thickness: 0.3, color: C.rule, dashArray: [1, 2] };
  page.drawLine({ start: { x: topO.x + p.L * s + 6, y: frontO.y + p.T * s }, end: { x: rightO.x - 6, y: frontO.y + p.T * s }, ...proj });
  return n;
}

function topView(page: PDFPage, f: Fonts, p: PartData, o: Pt, s: number) {
  const P = (q: Pt): Pt => ({ x: o.x + q.x * s, y: o.y + q.y * s });
  poly(page, p.outline.map(P), { fill: C.foam });
  // pockets: white, then the merged edges on top
  for (const r of p.regions) poly(page, regionPts(r).map(P), { fill: C.white });
  drawPieces(page, p.pieces, P, 0.9);
  poly(page, p.outline.map(P), { stroke: C.black, width: 1.4 });

  // datum at the lower-left corner (X / Y in the schedule are measured from here)
  page.drawCircle({ x: o.x, y: o.y, size: 2.2, color: C.black });
  page.drawText("0,0", { x: o.x - 15, y: o.y - 9, size: 5.5, font: f.r, color: C.muted });

  // balloons: at the pocket's center; if that spot is taken (a step inside a pocket) or the
  // pocket is small, try just inside its corners, else a leader out past its top-right corner.
  // Step 44b: each balloon gets a small size note (5" × 5", Ø1") when it fits without
  // crowding: under the balloon inside the pocket, or beside a leader balloon. The cavity
  // schedule stays the full spec, so a note that doesn't fit is simply left off.
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const taken: Box[] = [];
  const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const ballBox = (q: Pt): Box => ({ x0: q.x - 7, y0: q.y - 7, x1: q.x + 7, y1: q.y + 7 });
  const free = (q: Pt) => !taken.some((t) => hits(t, ballBox(q)));
  const NOTE = 6;
  // with many pockets, a size is noted once (the rest of that size are in the schedule)
  const noted = new Set<string>();
  const once = p.rows.length > 6;
  const note = (txt: string, box: Box, key: string) => {
    noted.add(key);
    page.drawRectangle({ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, color: C.white, opacity: 0.85 });
    page.drawText(txt, { x: box.x0 + 1, y: box.y0 + 1.6, size: NOTE, font: f.r, color: C.ink });
    taken.push(box);
  };
  const viewBox: Box = { x0: o.x, y0: o.y, x1: o.x + p.L * s, y1: o.y + p.W * s };
  // deepest first so a step's balloon sits on the step and its pocket's balloon moves aside
  const rows = [...p.rows].sort((m, q) => q.region.depth - m.region.depth || m.n - q.n);
  for (const row of rows) {
    const b = regionBox(row.region);
    const wPt = (b.x1 - b.x0) * s;
    const hPt = (b.y1 - b.y0) * s;
    const c = P({ x: row.cx, y: row.cy });
    const lo = P({ x: b.x0, y: b.y0 });
    const hi = P({ x: b.x1, y: b.y1 });
    const key = row.size;
    const count = p.rows.filter((r) => r.size === key).length;
    const txt = once && count > 1 ? `${count}X ${key}` : key; // drafting style: "18X 2 1/2" × 1 3/4""
    const tw = f.r.widthOfTextAtSize(txt, NOTE) + 2;
    const wantNote = !(once && noted.has(key));
    let at: Pt | null = null;
    if (wPt >= 16 && hPt >= 16) {
      const tries = [c, { x: lo.x + 9, y: hi.y - 9 }, { x: hi.x - 9, y: hi.y - 9 }, { x: lo.x + 9, y: lo.y + 9 }, { x: hi.x - 9, y: lo.y + 9 }];
      at = tries.find(free) ?? null;
    }
    if (at) {
      balloon(page, f, at.x, at.y, row.n);
      taken.push(ballBox(at));
      // a note never sits on another pocket, a balloon or another note
      const ownBox = regionBox(row.region);
      const isOwn = (r: CavityRegion) => {
        const rb = regionBox(r);
        return Math.abs(rb.x0 - ownBox.x0) + Math.abs(rb.y0 - ownBox.y0) + Math.abs(rb.x1 - ownBox.x1) + Math.abs(rb.y1 - ownBox.y1) < 1e-6;
      };
      const encloses = (r: CavityRegion) => {
        const rb = regionBox(r);
        return rb.x0 <= ownBox.x0 + 1e-6 && rb.y0 <= ownBox.y0 + 1e-6 && rb.x1 >= ownBox.x1 - 1e-6 && rb.y1 >= ownBox.y1 - 1e-6;
      };
      // other pockets, not counting one this pocket is a step inside of
      const others = p.regions.filter((r) => !isOwn(r) && !encloses(r)).map((r) => regionPts(r, 24).map(P));
      const inPoly = (q: Pt, pts: Pt[]) => {
        let c2 = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const u = pts[i];
          const v = pts[j];
          if (u.y > q.y !== v.y > q.y && q.x < ((v.x - u.x) * (q.y - u.y)) / (v.y - u.y) + u.x) c2 = !c2;
        }
        return c2;
      };
      const clear = (bx: Box) => {
        if (bx.x0 < viewBox.x0 + 1 || bx.x1 > viewBox.x1 - 1 || bx.y0 < viewBox.y0 + 1 || bx.y1 > viewBox.y1 - 1) return false;
        if (taken.some((t) => hits(t, bx))) return false;
        const xs = [bx.x0, (bx.x0 + bx.x1) / 2, bx.x1];
        const ys = [bx.y0, (bx.y0 + bx.y1) / 2, bx.y1];
        return !others.some((pts) => xs.some((x) => ys.some((y) => inPoly({ x, y }, pts))));
      };
      // inside the pocket: under the balloon (slid sideways to stay in), else beside it
      const nx0 = Math.max(lo.x + 2, Math.min(at.x - tw / 2, hi.x - 2 - tw));
      const inner: Box[] = [
        { x0: nx0, y0: at.y - 16.5, x1: nx0 + tw, y1: at.y - 8 },
        { x0: at.x + 8, y0: at.y - 4.5, x1: at.x + 8 + tw, y1: at.y + 4.5 },
      ];
      const inOwn = (bx: Box) => bx.x0 >= lo.x + 1 && bx.x1 <= hi.x - 1 && bx.y0 >= lo.y + 0.5 && bx.y1 <= hi.y - 1;
      const ib = wantNote ? inner.find((bx) => inOwn(bx) && clear(bx)) : undefined;
      if (ib) {
        note(txt, ib, key);
        continue;
      }
      // too small inside: below, above, left or right of the pocket, on clear foam
      const midY = c.y - 3;
      const outside: Box[] = [
        { x0: c.x - tw / 2, y0: lo.y - 11, x1: c.x + tw / 2, y1: lo.y - 2 }, // below
        { x0: c.x - tw / 2, y0: hi.y + 2, x1: c.x + tw / 2, y1: hi.y + 11 }, // above
        { x0: lo.x - 3 - tw, y0: midY, x1: lo.x - 3, y1: midY + 9 }, // left
        { x0: hi.x + 3, y0: midY, x1: hi.x + 3 + tw, y1: midY + 9 }, // right
      ];
      const ob = wantNote ? outside.find(clear) : undefined;
      if (ob) note(txt, ob, key);
      continue;
    }
    let to = { x: o.x + b.x1 * s + 13, y: o.y + b.y1 * s + 13 };
    for (let k = 0; k < 6 && !free(to); k++) to = { x: to.x + 14, y: to.y };
    page.drawLine({ start: c, end: to, thickness: 0.5, color: C.dim });
    page.drawCircle({ x: c.x, y: c.y, size: 1.2, color: C.dim });
    balloon(page, f, to.x, to.y, row.n);
    taken.push(ballBox(to));
    const nb: Box = { x0: to.x + 8, y0: to.y - 4, x1: to.x + 8 + tw, y1: to.y + 4 };
    const insideView = hits(nb, viewBox);
    if (wantNote && !taken.some((t) => hits(t, nb)) && nb.x1 <= MAIN_X + MAIN_W - 4 && !(insideView && p.rows.length > 12)) note(txt, nb, key);
  }
}

/** Hidden depth profile of the pockets along one axis (inches): runs of the deepest pocket. */
function depthProfile(p: PartData, axis: "x" | "y"): { a: number; b: number; d: number }[] {
  const spans = p.regions.map((r) => {
    const b = regionBox(r);
    return axis === "x" ? { a: b.x0, b: b.x1, d: r.depth } : { a: b.y0, b: b.y1, d: r.depth };
  });
  const cuts = Array.from(new Set(spans.flatMap((sp) => [sp.a, sp.b]))).sort((m, n) => m - n);
  const out: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    const d = Math.max(0, ...spans.filter((sp) => sp.a <= mid && sp.b >= mid).map((sp) => sp.d));
    const last = out[out.length - 1];
    if (last && Math.abs(last.b - a) < 1e-6 && Math.abs(last.d - d) < 1e-6) last.b = b;
    else out.push({ a, b, d });
  }
  return out.filter((r) => r.d > 0);
}

function sideView(page: PDFPage, o: Pt, s: number, len: number, T: number, prof: { a: number; b: number; d: number }[]) {
  page.drawRectangle({ x: o.x, y: o.y, width: len * s, height: T * s, color: C.foam });
  // hidden lines: walk each connected run of pockets
  const top = o.y + T * s;
  let run: Pt[] = [];
  const flush = () => {
    if (run.length > 1) polyline(page, run, C.hidden, 0.7, [3, 2]);
    run = [];
  };
  prof.forEach((seg, i) => {
    const prev = prof[i - 1];
    const joins = prev && Math.abs(prev.b - seg.a) < 1e-6;
    const x0 = o.x + seg.a * s;
    const x1 = o.x + seg.b * s;
    const yFloor = top - seg.d * s;
    if (!joins) {
      flush();
      run.push({ x: x0, y: top }, { x: x0, y: yFloor });
    } else {
      run.push({ x: x0, y: yFloor });
    }
    run.push({ x: x1, y: yFloor });
    const next = prof[i + 1];
    if (!next || Math.abs(next.a - seg.b) > 1e-6) {
      run.push({ x: x1, y: top });
      flush();
    }
  });
  flush();
  page.drawRectangle({ x: o.x, y: o.y, width: len * s, height: T * s, borderColor: C.black, borderWidth: 1.4 });
}

function frontView(page: PDFPage, _f: Fonts, p: PartData, o: Pt, s: number) {
  sideView(page, o, s, p.L, p.T, depthProfile(p, "x"));
}

function rightView(page: PDFPage, _f: Fonts, p: PartData, o: Pt, s: number) {
  // looking at the right end: the front of the part is on the left
  sideView(page, o, s, p.W, p.T, depthProfile(p, "y"));
}

// ─── Isometric view ───────────────────────────────────────────────────────────

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
// viewed from the front-right: the front (y = 0) face on the left, the right (x = L) face on the right
const iso = (x: number, y: number, z: number): Pt => ({ x: (x + y) * COS30, y: (y - x) * SIN30 + z });

function isoBounds(L: number, W: number, H: number) {
  const pts = [iso(0, 0, 0), iso(L, 0, 0), iso(0, W, 0), iso(L, W, 0), iso(0, 0, H), iso(L, W, H), iso(L, 0, H), iso(0, W, H)];
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** One part as a shaded solid: base z0, origin (ox, oy) points, k points per inch. */
function isoPart(page: PDFPage, p: PartData, z0: number, ox: number, oy: number, k: number, lineW = 0.6) {
  const at = (x: number, y: number, z: number): Pt => {
    const q = iso(x, y, z);
    return { x: ox + q.x * k, y: oy + q.y * k };
  };
  const zt = z0 + p.T;
  // side faces facing the viewer (outward normal toward front / right)
  // (filled with their own shade so a rounded corner's many facets don't read as a black band;
  // then ink on the bottom edges and on the vertical edges where the shade changes)
  const n = p.outline.length;
  const faces: (RGB | null)[] = [];
  for (let i = 0; i < n; i++) {
    const a = p.outline[i];
    const b = p.outline[(i + 1) % n];
    const nx = b.y - a.y;
    const ny = -(b.x - a.x);
    if (nx - ny <= 1e-9) {
      faces.push(null);
      continue;
    }
    const shade = Math.abs(ny) >= Math.abs(nx) ? C.isoFront : C.isoRight;
    faces.push(shade);
    poly(page, [at(a.x, a.y, z0), at(b.x, b.y, z0), at(b.x, b.y, zt), at(a.x, a.y, zt)], { fill: shade, stroke: shade, width: 0.4 });
  }
  for (let i = 0; i < n; i++) {
    if (!faces[i]) continue;
    const a = p.outline[i];
    const b = p.outline[(i + 1) % n];
    page.drawLine({ start: at(a.x, a.y, z0), end: at(b.x, b.y, z0), thickness: lineW, color: C.ink });
    if (faces[(i + n - 1) % n] !== faces[i]) page.drawLine({ start: at(a.x, a.y, z0), end: at(a.x, a.y, zt), thickness: lineW, color: C.ink });
    if (faces[(i + 1) % n] !== faces[i]) page.drawLine({ start: at(b.x, b.y, z0), end: at(b.x, b.y, zt), thickness: lineW, color: C.ink });
  }
  // top face
  poly(page, p.outline.map((q) => at(q.x, q.y, zt)), { fill: C.isoTop, stroke: C.ink, width: lineW });
  // pockets, shallow first: each opens at the top, or at the floor of a shallower pocket it sits in
  // (a step-down); its walls fill the opening, then its floor shows where it is visible through it
  const drawn = [...p.regions].sort((m, q) => m.depth - q.depth).map((r) => {
    const b = regionBox(r);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const shelf = Math.max(
      0,
      ...p.regions
        .filter((o) => o !== r && o.depth < r.depth - 1e-6)
        .filter((o) => {
          const ob = regionBox(o);
          return ob.x0 <= b.x0 + 1e-6 && ob.x1 >= b.x1 - 1e-6 && ob.y0 <= b.y0 + 1e-6 && ob.y1 >= b.y1 - 1e-6 && ob.x0 <= cx && ob.y0 <= cy;
        })
        .map((o) => o.depth),
    );
    const pts = regionPts(r, 32);
    const open = pts.map((q) => at(q.x, q.y, zt - shelf));
    const floor = pts.map((q) => at(q.x, q.y, zt - r.depth));
    const vis = r.kind === "poly" ? floor : clipConvex(floor, open);
    return { r, shelf, open, floor, vis, through: r.depth >= p.T - 1e-6 };
  });
  // pockets of the same depth that touch (a slot cut into a pocket's edge) are one opening:
  // all their walls first, then all their floors, so one never paints over the other's floor
  for (let i = 0; i < drawn.length; ) {
    let j = i;
    while (j < drawn.length && Math.abs(drawn[j].r.depth - drawn[i].r.depth) < 1e-6) j++;
    const grp = drawn.slice(i, j);
    for (const g of grp) poly(page, g.open, { fill: C.isoWall });
    // a floor shows through every opening of its group (one floor plane, cut as one pocket)
    for (const g of grp) {
      const fill = g.through ? C.white : C.isoFloor;
      if (g.vis.length >= 3) poly(page, g.vis, { fill });
      if (g.r.kind === "poly") continue;
      for (const h of grp) {
        if (h === g || h.r.kind === "poly") continue;
        const v = clipConvex(g.floor, h.open);
        if (v.length >= 3) poly(page, v, { fill });
      }
    }
    for (const g of grp) if (g.shelf > 0) poly(page, g.open, { stroke: C.ink, width: 0.4 });
    i = j;
  }
  isoPocketWalls(page, p, drawn, at, zt, lineW);
  drawPieces(page, p.pieces, (q) => at(q.x, q.y, zt), 0.5, true);
  poly(page, p.outline.map((q) => at(q.x, q.y, zt)), { stroke: C.ink, width: lineW });
}

/**
 * Step 44b: the pocket walls you can see (the back and left walls), shaded like the outside
 * faces, with ink on the wall-to-floor edge and on the inside corners. Built from the same
 * merged outline as the top view (so a slot cut into a pocket's side shows no wall across the
 * overlap); each wall runs from the shallower side's floor (or the top) down to the deeper
 * side's floor, and is clipped to that pocket's opening so it never paints over the top face.
 * Anything unexpected just leaves that wall out: the dark opening fill underneath still reads.
 */
function isoPocketWalls(
  page: PDFPage,
  p: PartData,
  drawn: { r: CavityRegion; open: Pt[] }[],
  at: (x: number, y: number, z: number) => Pt,
  zt: number,
  lineW: number,
) {
  const polys = drawn.map((d) => ({ d, pts: regionPts(d.r, 64) }));
  const inside = (q: Pt, pts: Pt[]) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  // deepest pocket under a plan point (0 = foam top)
  const under = (q: Pt) => {
    let best: { depth: number; d: (typeof drawn)[number] | null } = { depth: 0, d: null };
    for (const pp of polys) if (pp.d.r.depth > best.depth && inside(q, pp.pts)) best = { depth: pp.d.r.depth, d: pp.d };
    return best;
  };
  const tint = (c: RGB, k: number): RGB => rgb(c.red * k, c.green * k, c.blue * k);
  const SIDE = 0.01;

  // the merged edges as short straight runs (arcs every ~10°)
  const segs: { a: Pt; b: Pt }[] = [];
  for (const pc of p.pieces) {
    if (pc.t === "line") segs.push({ a: { x: pc.x1, y: pc.y1 }, b: { x: pc.x2, y: pc.y2 } });
    else {
      const span = pc.a1 - pc.a0;
      const n = Math.max(2, Math.ceil(Math.abs(span) / (Math.PI / 18)));
      for (let i = 0; i < n; i++) {
        const t0 = pc.a0 + (span * i) / n;
        const t1 = pc.a0 + (span * (i + 1)) / n;
        segs.push({
          a: { x: pc.cx + pc.r * Math.cos(t0), y: pc.cy + pc.r * Math.sin(t0) },
          b: { x: pc.cx + pc.r * Math.cos(t1), y: pc.cy + pc.r * Math.sin(t1) },
        });
      }
    }
  }

  type Wall = { quad: Pt[]; bottom: [Pt, Pt]; open: Pt[]; shade: RGB; nx: number; ny: number; a: Pt; b: Pt; zTop: number; zBot: number };
  const walls: Wall[] = [];
  for (const sg of segs) {
    const dx = sg.b.x - sg.a.x;
    const dy = sg.b.y - sg.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const mid = { x: (sg.a.x + sg.b.x) / 2, y: (sg.a.y + sg.b.y) / 2 };
    const left = { x: -dy / len, y: dx / len };
    const sl = under({ x: mid.x + left.x * SIDE, y: mid.y + left.y * SIDE });
    const sr = under({ x: mid.x - left.x * SIDE, y: mid.y - left.y * SIDE });
    if (Math.abs(sl.depth - sr.depth) < 1e-6) continue;
    const deep = sl.depth > sr.depth ? sl : sr;
    const shallow = sl.depth > sr.depth ? sr : sl;
    if (!deep.d) continue;
    // the wall faces into the deeper side; visible when that faces the viewer (front-right)
    const nx = sl.depth > sr.depth ? left.x : -left.x;
    const ny = sl.depth > sr.depth ? left.y : -left.y;
    if (nx - ny <= 1e-6) continue;
    const zTop = zt - shallow.depth;
    const zBot = zt - deep.depth;
    const w = Math.abs(ny) / (Math.abs(nx) + Math.abs(ny)); // 1 = faces front, 0 = faces right
    const base = rgb(
      C.isoRight.red + (C.isoFront.red - C.isoRight.red) * w,
      C.isoRight.green + (C.isoFront.green - C.isoRight.green) * w,
      C.isoRight.blue + (C.isoFront.blue - C.isoRight.blue) * w,
    );
    walls.push({
      quad: [at(sg.a.x, sg.a.y, zTop), at(sg.b.x, sg.b.y, zTop), at(sg.b.x, sg.b.y, zBot), at(sg.a.x, sg.a.y, zBot)],
      bottom: [at(sg.a.x, sg.a.y, zBot), at(sg.b.x, sg.b.y, zBot)],
      open: deep.d.open,
      shade: tint(base, 0.82), // inside the pocket: a little darker than the outside faces
      nx,
      ny,
      a: sg.a,
      b: sg.b,
      zTop,
      zBot,
    });
  }
  // through-cut walls end at the bottom of the part; the floor there is open (white), keep the edge
  for (const w of walls) {
    const vis = clipConvex(w.quad, w.open);
    if (vis.length >= 3) poly(page, vis, { fill: w.shade, stroke: w.shade, width: 0.3 });
  }
  const segClip = (a: Pt, b: Pt, clip: Pt[]): [Pt, Pt] | null => {
    // a segment clipped to a convex polygon (Cyrus–Beck); null when nothing is left
    let area = 0;
    for (let i = 0; i < clip.length; i++) {
      const u = clip[i];
      const v = clip[(i + 1) % clip.length];
      area += u.x * v.y - v.x * u.y;
    }
    const sgn = area > 0 ? 1 : -1;
    let t0 = 0;
    let t1 = 1;
    const d = { x: b.x - a.x, y: b.y - a.y };
    for (let i = 0; i < clip.length; i++) {
      const u = clip[i];
      const v = clip[(i + 1) % clip.length];
      const nIn = { x: -(v.y - u.y) * sgn, y: (v.x - u.x) * sgn };
      const num = nIn.x * (a.x - u.x) + nIn.y * (a.y - u.y);
      const den = nIn.x * d.x + nIn.y * d.y;
      if (Math.abs(den) < 1e-12) {
        if (num < -1e-9) return null;
        continue;
      }
      const t = -num / den;
      if (den > 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
    return [{ x: a.x + d.x * t0, y: a.y + d.y * t0 }, { x: a.x + d.x * t1, y: a.y + d.y * t1 }];
  };
  const ink = (a: Pt, b: Pt, clip: Pt[]) => {
    const c = clip.length >= 3 ? segClip(a, b, clip) : [a, b];
    if (c && Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) > 0.2) page.drawLine({ start: c[0], end: c[1], thickness: lineW * 0.7, color: C.ink });
  };
  // the wall-to-floor edge, and a vertical edge where two walls meet at a corner
  // (a sharp turn, not the small steps around an arc)
  for (const w of walls) ink(w.bottom[0], w.bottom[1], w.open);
  const key = (q: Pt) => `${Math.round(q.x * 1e4)},${Math.round(q.y * 1e4)}`;
  const byEnd = new Map<string, Wall[]>();
  for (const w of walls) for (const q of [w.a, w.b]) byEnd.set(key(q), [...(byEnd.get(key(q)) ?? []), w]);
  const done = new Set<string>();
  for (const [k, ws] of byEnd) {
    if (done.has(k)) continue;
    done.add(k);
    const q = ws[0].a && key(ws[0].a) === k ? ws[0].a : ws[0].b;
    const sharp = ws.length === 1 || (ws.length >= 2 && ws[0].nx * ws[1].nx + ws[0].ny * ws[1].ny < Math.cos(Math.PI / 9));
    if (!sharp) continue;
    const top = Math.max(...ws.map((w) => w.zTop));
    const bot = Math.min(...ws.map((w) => w.zBot));
    ink(at(q.x, q.y, top), at(q.x, q.y, bot), ws[0].open);
  }
}

/** Step 44b: bold line centered across the top of the main area on every sheet. */
function autoNote(page: PDFPage, f: Fonts) {
  let size = 11;
  const maxW = MAIN_W - 24;
  while (size > 7 && f.b.widthOfTextAtSize(AUTO_NOTE, size) > maxW) size -= 0.5;
  const tw = f.b.widthOfTextAtSize(AUTO_NOTE, size);
  const y = MAIN_Y + MAIN_H - BANNER_H / 2 - size / 2 - 2;
  page.drawText(AUTO_NOTE, { x: MAIN_X + (MAIN_W - tw) / 2, y, size, font: f.b, color: C.black });
}

function isoPanel(page: PDFPage, f: Fonts, p: PartData) {
  const box = { x: RC_X, y: MAIN_Y + 200, w: RC_W, h: 190 };
  sectionHeader(page, f, box.x, box.y + box.h - 14, box.w, "ISOMETRIC VIEW");
  const b = isoBounds(p.L, p.W, p.T);
  const k = Math.min((box.w - 30) / (b.x1 - b.x0), (box.h - 40) / (b.y1 - b.y0));
  const ox = box.x + (box.w - (b.x1 - b.x0) * k) / 2 - b.x0 * k;
  const oy = box.y + 18 + (box.h - 40 - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
  isoPart(page, p, 0, ox, oy, k);
  page.drawText("NOT TO SCALE", { x: box.x + box.w - 6 - f.r.widthOfTextAtSize("NOT TO SCALE", 5.5), y: box.y + 5, size: 5.5, font: f.r, color: C.muted });
}

function assemblyView(page: PDFPage, f: Fonts, parts: PartData[]) {
  const L = parts[0].L;
  const W = parts[0].W;
  const gapIn = Math.max(1, (L + W) * 0.3); // exploded spacing: enough to see into the lower part's pockets
  const total = parts.reduce((s, p) => s + p.T, 0) + gapIn * (parts.length - 1);
  const b = isoBounds(L, W, total);
  const area = { x: MAIN_X + 30, y: MAIN_Y + 40, w: MAIN_W - 60, h: MAIN_H - 70 - BANNER_H };
  const k = Math.min(area.w / (b.x1 - b.x0), area.h / (b.y1 - b.y0));
  const ox = area.x + (area.w - (b.x1 - b.x0) * k) / 2 - b.x0 * k;
  const oy = area.y + (area.h - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
  // bottom part first so upper parts overlap it
  let z = 0;
  const tags: { n: number; at: Pt }[] = [];
  parts.forEach((p, i) => {
    isoPart(page, p, z, ox, oy, k, 0.7);
    const q = iso(L, W * 0.5, z + p.T / 2); // middle of the right face
    tags.push({ n: i + 1, at: { x: ox + q.x * k, y: oy + q.y * k } });
    z += p.T + gapIn;
  });
  const rightX = ox + b.x1 * k + 18; // balloons stand clear of the parts, to the right
  for (const t of tags) {
    const to = { x: Math.min(rightX, MAIN_X + MAIN_W - 14), y: t.at.y };
    page.drawCircle({ x: t.at.x, y: t.at.y, size: 1.4, color: C.ink });
    page.drawLine({ start: t.at, end: { x: to.x - 6, y: to.y }, thickness: 0.5, color: C.dim });
    balloon(page, f, to.x, to.y, t.n);
  }
  viewLabel(page, f, "EXPLODED ASSEMBLY (NOT TO SCALE)", MAIN_X + MAIN_W / 2, MAIN_Y + 20);
}

/** Sutherland–Hodgman: subject clipped by a convex polygon (any winding). */
function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  if (clip.length < 3) return subject;
  let area = 0;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    area += a.x * b.y - b.x * a.y;
  }
  const ccw = area > 0;
  const inside = (p: Pt, a: Pt, b: Pt) => {
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return ccw ? c >= -1e-9 : c <= 1e-9;
  };
  const cross = (p1: Pt, p2: Pt, a: Pt, b: Pt): Pt => {
    const A1 = p2.y - p1.y, B1 = p1.x - p2.x, C1 = A1 * p1.x + B1 * p1.y;
    const A2 = b.y - a.y, B2 = a.x - b.x, C2 = A2 * a.x + B2 * a.y;
    const det = A1 * B2 - A2 * B1;
    if (Math.abs(det) < 1e-12) return p2;
    return { x: (B2 * C1 - B1 * C2) / det, y: (A1 * C2 - A2 * C1) / det };
  };
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const ci = inside(cur, a, b);
      const pi = inside(prev, a, b);
      if (ci) {
        if (!pi) out.push(cross(prev, cur, a, b));
        out.push(cur);
      } else if (pi) out.push(cross(prev, cur, a, b));
    }
  }
  return out;
}

// ─── Right column panels ──────────────────────────────────────────────────────

function partPanel(page: PDFPage, f: Fonts, input: Drawing3DInput, layer: Layer3D, li: number, total: number) {
  const x = RC_X;
  const top = MAIN_Y + MAIN_H;
  const h = 108;
  const y = top - h;
  sectionHeader(page, f, x, top - 14, RC_W, "PART DETAILS");
  const mods: string[] = [];
  if (layer.roundCorners && layer.roundRadiusIn) mods.push(`Rounded corners R${fmtIn(layer.roundRadiusIn)}`);
  else if (layer.cropCorners) mods.push(`Cropped corners ${fmtIn(input.block.chamferIn ?? 1)}`);
  const rows: [string, string][] = [
    ["PART", `${partName(layer.label, li)}  (${li + 1} of ${total})`],
    ["SIZE", `${fmtIn(input.block.lengthIn)} \xD7 ${fmtIn(input.block.widthIn)} \xD7 ${fmtIn(layer.thicknessIn)}`],
    ["MATERIAL", layer.materialName || "—"],
    ["POCKETS", layer.cavities.length ? String(layer.cavities.length) : "None"],
    ["CORNERS", mods.length ? mods.join("; ") : "Square"],
    ["QUOTE", input.quoteNo],
  ];
  let ry = top - 28;
  for (const [k, v] of rows) {
    page.drawText(k, { x: x + 8, y: ry, size: 6.5, font: f.b, color: C.muted });
    page.drawText(fit(v, f.r, 7.5, RC_W - 70), { x: x + 62, y: ry, size: 7.5, font: f.r, color: C.ink });
    ry -= 12.5;
  }
  page.drawLine({ start: { x, y }, end: { x: x + RC_W, y }, thickness: 0.75, color: C.black });
}

function schedulePanel(page: PDFPage, f: Fonts, p: PartData) {
  const x = RC_X;
  const top = MAIN_Y + 200;
  sectionHeader(page, f, x, top - 14, RC_W, "CAVITY SCHEDULE");
  if (!p.rows.length) {
    page.drawText("No pockets in this part.", { x: x + 8, y: top - 30, size: 7, font: f.r, color: C.muted });
    return;
  }
  const cols = [
    { k: "#", w: 16 },
    { k: "SHAPE", w: 40 },
    { k: "SIZE", w: 74 },
    { k: "DEPTH", w: 40 },
    { k: "X", w: 38 },
    { k: "Y", w: 38 },
  ];
  let cx = x + 6;
  let ry = top - 27;
  for (const c of cols) {
    page.drawText(c.k, { x: cx, y: ry, size: 6, font: f.b, color: C.ink });
    cx += c.w;
  }
  ry -= 3;
  page.drawLine({ start: { x: x + 6, y: ry }, end: { x: x + RC_W - 6, y: ry }, thickness: 0.4, color: C.rule });
  ry -= 9;
  // rows tighten (down to 7.4pt) before any spill to "+ N more"
  const room = ry - (MAIN_Y + 22);
  const rowH = Math.max(7.4, Math.min(10, room / Math.max(1, p.rows.length - 1)));
  const fs = rowH < 9 ? 6 : 6.5;
  const maxRows = Math.floor(room / rowH) + 1;
  const shown = p.rows.length > maxRows ? p.rows.slice(0, maxRows - 1) : p.rows;
  for (const r of shown) {
    const vals = [String(r.n), r.shape, r.size, r.through ? "THRU" : fmtIn(r.depth), fmtIn(r.cx), fmtIn(r.cy)];
    cx = x + 6;
    vals.forEach((v, i) => {
      page.drawText(fit(v, f.r, fs, cols[i].w - 3), { x: cx, y: ry, size: fs, font: f.r, color: C.ink });
      cx += cols[i].w;
    });
    ry -= rowH;
  }
  if (shown.length < p.rows.length) {
    page.drawText(`+ ${p.rows.length - shown.length} more pockets (see the DXF)`, { x: x + 6, y: ry, size: 6.5, font: f.r, color: C.muted });
  }
  page.drawText("X / Y = POCKET CENTER FROM THE LOWER-LEFT CORNER (0,0) IN THE TOP VIEW.", {
    x: x + 6,
    y: MAIN_Y + 6,
    size: 5,
    font: f.r,
    color: C.muted,
  });
}

function bomPanel(page: PDFPage, f: Fonts, input: Drawing3DInput, parts: PartData[]) {
  const x = RC_X;
  const top = MAIN_Y + MAIN_H;
  sectionHeader(page, f, x, top - 14, RC_W, "PARTS LIST (PER SET)");
  const cols = [
    { k: "ITEM", w: 26 },
    { k: "PART", w: 82 },
    { k: "SIZE", w: 86 },
    { k: "QTY", w: 24 },
  ];
  let cx = x + 6;
  let ry = top - 27;
  for (const c of cols) {
    page.drawText(c.k, { x: cx, y: ry, size: 6, font: f.b, color: C.ink });
    cx += c.w;
  }
  ry -= 3;
  page.drawLine({ start: { x: x + 6, y: ry }, end: { x: x + RC_W - 6, y: ry }, thickness: 0.4, color: C.rule });
  ry -= 10;
  input.layers.forEach((l, i) => {
    const vals = [String(i + 1), partName(l.label, i), `${fmtIn(parts[i].L)} \xD7 ${fmtIn(parts[i].W)} \xD7 ${fmtIn(parts[i].T)}`, "1"];
    cx = x + 6;
    vals.forEach((v, j) => {
      page.drawText(fit(v, f.r, 6.8, cols[j].w - 3), { x: cx, y: ry, size: 6.8, font: f.r, color: C.ink });
      cx += cols[j].w;
    });
    ry -= 9;
    if (l.materialName) {
      page.drawText(fit(l.materialName, f.r, 6, cols[1].w + cols[2].w), { x: x + 6 + cols[0].w, y: ry, size: 6, font: f.r, color: C.muted });
      ry -= 11;
    }
  });
  page.drawText("Item 1 is the bottom of the set; each sheet shows one part.", { x: x + 6, y: ry - 4, size: 6, font: f.r, color: C.muted });
}

function sectionHeader(page: PDFPage, f: Fonts, x: number, y: number, w: number, label: string) {
  page.drawRectangle({ x, y, width: w, height: 14, color: C.header, borderColor: C.black, borderWidth: 0.5 });
  page.drawText(label, { x: x + 6, y: y + 4, size: 7, font: f.b, color: C.ink });
}

// ─── Frame and title block ────────────────────────────────────────────────────

function frame(page: PDFPage) {
  page.drawRectangle({ x: M, y: M, width: PW - 2 * M, height: PH - 2 * M, borderColor: C.black, borderWidth: 1.5 });
  // right column and title block rules
  page.drawLine({ start: { x: RC_X, y: MAIN_Y }, end: { x: RC_X, y: PH - M }, thickness: 0.75, color: C.black });
  page.drawLine({ start: { x: M, y: MAIN_Y }, end: { x: PW - M, y: MAIN_Y }, thickness: 1.2, color: C.black });
  // zone ticks along the border (drawing-sheet look)
  for (let i = 1; i < 8; i++) {
    const x = M + ((PW - 2 * M) * i) / 8;
    page.drawLine({ start: { x, y: PH - M }, end: { x, y: PH - M - 5 }, thickness: 0.5, color: C.black });
  }
  for (let i = 1; i < 6; i++) {
    const y = MAIN_Y + ((PH - M - MAIN_Y) * i) / 6;
    page.drawLine({ start: { x: M, y }, end: { x: M + 5, y }, thickness: 0.5, color: C.black });
  }
}

function titleBlock(
  page: PDFPage,
  f: Fonts,
  t: {
    input: Drawing3DInput;
    title: string;
    description: string;
    material: string;
    notes: string[];
    rev: string;
    date: string;
    scale: string;
    sheet: string;
  },
) {
  const x = M;
  const y = M;
  const w = PW - 2 * M;
  const h = TB_H;
  const notesW = w * 0.40;
  const midW = w * 0.28;
  const rightX = x + notesW + midW;
  const rightW = w - notesW - midW;

  // notes
  page.drawText("NOTES", { x: x + 8, y: y + h - 13, size: 7, font: f.b, color: C.ink });
  let ny = y + h - 24;
  t.notes.slice(0, 6).forEach((n, i) => {
    page.drawText(fit(`${i + 1}. ${n}`, f.r, 6.2, notesW - 16), { x: x + 8, y: ny, size: 6.2, font: f.r, color: C.ink });
    ny -= 8.6;
  });
  page.drawLine({ start: { x: x + notesW, y }, end: { x: x + notesW, y: y + h }, thickness: 0.75, color: C.black });

  // description / material / quote / customer
  const mx = x + notesW;
  const fields: [string, string][] = [
    ["DESCRIPTION", t.description],
    ["MATERIAL", t.material],
    ["QUOTE", t.input.quoteNo],
    ["CUSTOMER", t.input.customerName || "—"],
  ];
  const rowH = h / fields.length;
  fields.forEach(([k, v], i) => {
    const ry = y + h - (i + 1) * rowH;
    if (i > 0) page.drawLine({ start: { x: mx, y: ry + rowH }, end: { x: mx + midW, y: ry + rowH }, thickness: 0.4, color: C.rule });
    page.drawText(k, { x: mx + 6, y: ry + rowH - 8, size: 5.2, font: f.b, color: C.muted });
    page.drawText(fit(v, f.r, 7.2, midW - 12), { x: mx + 6, y: ry + 4, size: 7.2, font: f.r, color: C.ink });
  });
  page.drawLine({ start: { x: rightX, y }, end: { x: rightX, y: y + h }, thickness: 0.75, color: C.black });

  // shop band + rev / date / scale / sheet
  const bandH = 34;
  page.drawRectangle({ x: rightX, y: y + h - bandH, width: rightW, height: bandH, color: C.band });
  const shop = (t.input.shopName || "").trim();
  page.drawText(fit(shop ? shop.toUpperCase() : "FOAM INSERT DRAWING", f.b, 11, rightW - 16), {
    x: rightX + 8,
    y: y + h - 15,
    size: 11,
    font: f.b,
    color: C.white,
  });
  page.drawText(fit(t.title, f.r, 7.5, rightW - 16), { x: rightX + 8, y: y + h - 28, size: 7.5, font: f.r, color: rgb(0.85, 0.85, 0.85) });
  const cells: [string, string][] = [
    ["REV", t.rev],
    ["DATE", t.date],
    ["SCALE", t.scale],
    ["SHEET", t.sheet],
  ];
  const cw = rightW / cells.length;
  const ch = h - bandH;
  cells.forEach(([k, v], i) => {
    const cx = rightX + i * cw;
    if (i > 0) page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y + ch }, thickness: 0.4, color: C.rule });
    page.drawText(k, { x: cx + 5, y: y + ch - 10, size: 5.2, font: f.b, color: C.muted });
    page.drawText(fit(v, f.b, 9, cw - 8), { x: cx + 5, y: y + 9, size: 9, font: f.b, color: C.ink });
  });
  page.drawText("FOR MANUFACTURING USE – CONFIDENTIAL", {
    x: x + w - 6 - f.r.widthOfTextAtSize("FOR MANUFACTURING USE – CONFIDENTIAL", 4.8),
    y: y - 8,
    size: 4.8,
    font: f.r,
    color: C.muted,
  });
}

function generalNotes(input: Drawing3DInput, parts: PartData[]): string[] {
  if (input.notes && input.notes.length) return input.notes;
  const anyDepth = parts.some((p) => p.pieces.some((q) => q.layer === "depth"));
  const anyThrough = parts.some((p) => p.pieces.some((q) => q.layer === "through"));
  return [
    "ALL DIMENSIONS IN INCHES. DO NOT SCALE DRAWING.",
    `TOLERANCES: OUTSIDE \xB11/8"; POCKETS \xB11/16"; THICKNESS \xB11/16".`,
    "POCKET SIZES, DEPTHS AND LOCATIONS: SEE THE CAVITY SCHEDULE.",
    "TOUCHING / OVERLAPPING POCKETS ARE CUT AS ONE POCKET.",
    ...(anyDepth ? ["DASHED BLUE: FLOOR STEP INSIDE A POCKET."] : []),
    ...(anyThrough ? ["MAGENTA: CUT THROUGH THE PART."] : []),
    ...(parts.length > 1 ? ["SET PARTS ARE LAMINATED / PACKED PER THE QUOTE."] : []),
  ];
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

/** Fill and / or stroke a polygon (points in page coordinates). */
function poly(page: PDFPage, pts: Pt[], o: { fill?: RGB; stroke?: RGB; width?: number; dash?: number[] }) {
  if (pts.length < 3) return;
  const d = "M " + pts.map((q) => `${q.x.toFixed(2)} ${(-q.y).toFixed(2)}`).join(" L ") + " Z";
  page.drawSvgPath(d, {
    x: 0,
    y: 0,
    ...(o.fill ? { color: o.fill } : {}),
    ...(o.stroke ? { borderColor: o.stroke, borderWidth: o.width ?? 1 } : { borderWidth: 0 }),
    ...(o.dash ? { borderDashArray: o.dash } : {}),
  });
}

function polyline(page: PDFPage, pts: Pt[], color: RGB, width: number, dash?: number[]) {
  for (let i = 0; i < pts.length - 1; i++) {
    page.drawLine({ start: pts[i], end: pts[i + 1], thickness: width, color, ...(dash ? { dashArray: dash } : {}) });
  }
}

/** Merged pocket edges (inches) through a projection: cut solid, floor step dashed blue, through magenta. */
function drawPieces(page: PDFPage, pieces: OutlinePiece[], P: (q: Pt) => Pt, w: number, iso = false) {
  for (const pc of pieces) {
    if (iso && pc.layer === "depth") continue; // the iso shows the step itself
    const color = iso ? C.ink : pc.layer === "depth" ? C.depth : pc.layer === "through" ? C.through : C.black;
    const dash = pc.layer === "depth" ? [3, 2] : undefined;
    if (pc.t === "line") {
      polyline(page, [P({ x: pc.x1, y: pc.y1 }), P({ x: pc.x2, y: pc.y2 })], color, w, dash);
    } else {
      const span = pc.a1 - pc.a0;
      const steps = Math.max(6, Math.ceil((Math.abs(span) / (Math.PI * 2)) * 48));
      const pts = Array.from({ length: steps + 1 }, (_, i) => {
        const a = pc.a0 + (span * i) / steps;
        return P({ x: pc.cx + pc.r * Math.cos(a), y: pc.cy + pc.r * Math.sin(a) });
      });
      polyline(page, pts, color, w, dash);
    }
  }
}

function balloon(page: PDFPage, f: Fonts, x: number, y: number, n: number) {
  const r = 6;
  page.drawCircle({ x, y, size: r, color: C.white, borderColor: C.black, borderWidth: 0.7 });
  const t = String(n);
  const tw = f.b.widthOfTextAtSize(t, 7);
  page.drawText(t, { x: x - tw / 2, y: y - 2.5, size: 7, font: f.b, color: C.black });
}

function viewLabel(page: PDFPage, f: Fonts, label: string, cx: number, y: number) {
  const tw = f.b.widthOfTextAtSize(label, 7.5);
  page.drawText(label, { x: cx - tw / 2, y, size: 7.5, font: f.b, color: C.ink });
  page.drawLine({ start: { x: cx - tw / 2, y: y - 2 }, end: { x: cx + tw / 2, y: y - 2 }, thickness: 0.5, color: C.ink });
}

function arrow(page: PDFPage, tip: Pt, dx: number, dy: number) {
  // filled arrowhead pointing along (dx, dy)
  const len = 5;
  const half = 1.6;
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const base = { x: tip.x - ux * len, y: tip.y - uy * len };
  poly(page, [tip, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }], { fill: C.dim });
}

function hDim(page: PDFPage, f: Fonts, x1: number, x2: number, edgeY: number, dimY: number, text: string) {
  const up = dimY > edgeY ? 1 : -1;
  page.drawLine({ start: { x: x1, y: edgeY + up * 2 }, end: { x: x1, y: dimY + up * 3 }, thickness: 0.4, color: C.dim });
  page.drawLine({ start: { x: x2, y: edgeY + up * 2 }, end: { x: x2, y: dimY + up * 3 }, thickness: 0.4, color: C.dim });
  page.drawLine({ start: { x: x1, y: dimY }, end: { x: x2, y: dimY }, thickness: 0.4, color: C.dim });
  arrow(page, { x: x1, y: dimY }, -1, 0);
  arrow(page, { x: x2, y: dimY }, 1, 0);
  const tw = f.r.widthOfTextAtSize(text, 7.5);
  const mx = (x1 + x2) / 2;
  page.drawRectangle({ x: mx - tw / 2 - 2, y: dimY - 4, width: tw + 4, height: 9, color: C.white });
  page.drawText(text, { x: mx - tw / 2, y: dimY - 2.6, size: 7.5, font: f.r, color: C.ink });
}

function vDim(page: PDFPage, f: Fonts, y1: number, y2: number, edgeX: number, dimX: number, text: string) {
  const dir = dimX > edgeX ? 1 : -1;
  page.drawLine({ start: { x: edgeX + dir * 2, y: y1 }, end: { x: dimX + dir * 3, y: y1 }, thickness: 0.4, color: C.dim });
  page.drawLine({ start: { x: edgeX + dir * 2, y: y2 }, end: { x: dimX + dir * 3, y: y2 }, thickness: 0.4, color: C.dim });
  page.drawLine({ start: { x: dimX, y: y1 }, end: { x: dimX, y: y2 }, thickness: 0.4, color: C.dim });
  arrow(page, { x: dimX, y: y1 }, 0, -1);
  arrow(page, { x: dimX, y: y2 }, 0, 1);
  // text reads along the dim line (rotated), centered
  const size = 7.5;
  const tw = f.r.widthOfTextAtSize(text, size);
  const my = (y1 + y2) / 2;
  if (Math.abs(y2 - y1) > tw + 6) {
    page.drawRectangle({ x: dimX - 4.5, y: my - tw / 2 - 2, width: 9, height: tw + 4, color: C.white });
    page.drawText(text, { x: dimX + 2.6, y: my - tw / 2, size, font: f.r, color: C.ink, rotate: degrees(90) });
  } else {
    // short span: text beside the dim line
    page.drawText(text, { x: dimX - tw - 4, y: my - 2.6, size, font: f.r, color: C.ink });
  }
}

/** Trim a string to a width (adds "…"). */
function fit(text: string, font: PDFFont, size: number, maxW: number): string {
  const clean = String(text ?? "").replace(/[^\x20-\x7E\xA0-\xFF–—…]/g, "");
  if (font.widthOfTextAtSize(clean, size) <= maxW) return clean;
  let s = clean;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

/**
 * Inches for a drawing: whole sixteenths as fractions (9 7/8"), anything else
 * to three decimals (2.531"). Pure; exported for the tests.
 */
export function fmtIn(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const neg = v < 0;
  const a = Math.abs(v);
  const n16 = Math.round(a * 16);
  if (Math.abs(a - n16 / 16) > 0.004) return `${neg ? "-" : ""}${a.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}"`;
  const whole = Math.floor(n16 / 16);
  let num = n16 % 16;
  let den = 16;
  while (num && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const frac = num ? `${num}/${den}` : "";
  const body = whole && frac ? `${whole} ${frac}` : whole ? `${whole}` : frac || "0";
  return `${neg ? "-" : ""}${body}"`;
}

/** For scripts/test-drawing-pdf.ts only. */
export const threeviewInternals = { partData, depthProfile, AUTO_NOTE };
