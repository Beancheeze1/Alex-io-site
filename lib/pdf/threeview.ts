// lib/pdf/threeview.ts
//
// CAD-style technical drawing: Front View, Top View, Isometric View + title block.

import { PDFDocument, PDFPage, rgb, StandardFonts } from "pdf-lib";

// ─── Public types ─────────────────────────────────────────────────────────────

export type Block3D = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export type Cavity3D = {
  id: string;
  shape: "rect" | "circle" | "poly";
  x: number;
  y: number;
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  diameterIn?: number;
  points?: Array<{ x: number; y: number }>;
  label?: string;
};

export type Layer3D = {
  id: string;
  label?: string;
  thicknessIn: number;
  materialName?: string;
  cavities: Cavity3D[];
};

export type Drawing3DInput = {
  quoteNo: string;
  customerName?: string;
  block: Block3D;
  layers: Layer3D[];
  revision?: string;
  date?: string;
  notes?: string[];
};

// ─── Colours ──────────────────────────────────────────────────────────────────

const C = {
  black:      rgb(0,    0,    0),
  white:      rgb(1,    1,    1),
  dimLine:    rgb(0.20, 0.20, 0.20),
  foam:       rgb(0.92, 0.92, 0.92),
  foamAlt:    rgb(0.97, 0.97, 0.97),
  cavityLine: rgb(0.72, 0,    0),
  titleBg:    rgb(0.10, 0.10, 0.10),
  titleFg:    rgb(1,    1,    1),
  headerBg:   rgb(0.84, 0.84, 0.84),
  crosshair:  rgb(0.65, 0.65, 0.65),
  // Iso face shades — clearly distinct
  isoTop:     rgb(0.93, 0.93, 0.93),
  isoRight:   rgb(0.78, 0.78, 0.78),
  isoFront:   rgb(0.68, 0.68, 0.68),
  gridLight:  rgb(0.75, 0.75, 0.75),
};

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generate3ViewPDF(input: Drawing3DInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const PW = 792, PH = 612; // 11×8.5 landscape
  const page = pdfDoc.addPage([PW, PH]);

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const MARGIN  = 24;
  const TITLE_H = 90;
  const PAD     = 14;
  const LABEL_H = 18;

  const frameX = MARGIN;
  const frameY = MARGIN + TITLE_H;
  const frameW = PW - 2 * MARGIN;
  const frameH = PH - 2 * MARGIN - TITLE_H;
  const colW   = frameW / 2;
  const rowH   = frameH / 2;

  // Cell origins (bottom-left corner of each quadrant)
  const cells = {
    front: { x: frameX,        y: frameY + rowH, w: colW, h: rowH },
    top:   { x: frameX + colW, y: frameY + rowH, w: colW, h: rowH },
    notes: { x: frameX,        y: frameY,         w: colW, h: rowH },
    iso:   { x: frameX + colW, y: frameY,         w: colW, h: rowH },
  };

  // Outer border
  page.drawRectangle({ x: MARGIN, y: MARGIN, width: PW-2*MARGIN, height: PH-2*MARGIN, borderColor: C.black, borderWidth: 2 });

  // Cell dividers
  page.drawLine({ start: { x: frameX+colW, y: frameY }, end: { x: frameX+colW, y: frameY+frameH }, thickness: 0.75, color: C.black });
  page.drawLine({ start: { x: frameX, y: frameY+rowH }, end: { x: frameX+frameW, y: frameY+rowH }, thickness: 0.75, color: C.black });

  const { block, layers } = input;

  viewCell(page, cells.front, "FRONT VIEW", font, fontBold, PAD, LABEL_H, (vx,vy,vw,vh) =>
    drawFrontView(page, vx, vy, vw, vh, block, layers, font));

  viewCell(page, cells.top, "TOP VIEW", font, fontBold, PAD, LABEL_H, (vx,vy,vw,vh) =>
    drawTopView(page, vx, vy, vw, vh, block, layers, font));

  viewCell(page, cells.iso, "ISOMETRIC VIEW", font, fontBold, PAD, LABEL_H, (vx,vy,vw,vh) =>
    drawIsoView(page, vx, vy, vw, vh, block, layers, font));

  notesCell(page, cells.notes, input, font, fontBold, PAD, LABEL_H);

  titleBlock(page, frameX, MARGIN, frameW, TITLE_H, font, fontBold,
    input.quoteNo, input.customerName, input.revision||"AS",
    input.date || new Date().toISOString().split("T")[0],
    "FOAM INSERT \u2013 TECHNICAL DRAWING");

  return Buffer.from(await pdfDoc.save());
}

// ─── Cell wrapper ─────────────────────────────────────────────────────────────

function viewCell(
  page: PDFPage,
  cell: { x:number; y:number; w:number; h:number },
  label: string, font: any, fontBold: any, pad: number, labelH: number,
  fn: (vx:number, vy:number, vw:number, vh:number) => void,
) {
  const { x, y, w, h } = cell;
  page.drawRectangle({ x, y: y+h-labelH, width: w, height: labelH, color: C.headerBg, borderColor: C.black, borderWidth: 0.5 });
  const tw = label.length * 5.4;
  page.drawText(label, { x: x+(w-tw)/2, y: y+h-labelH+5, size: 8, font: fontBold, color: C.black });
  fn(x+pad, y+pad, w-2*pad, h-labelH-2*pad);
}

// ─── Notes cell ───────────────────────────────────────────────────────────────

function notesCell(
  page: PDFPage,
  cell: { x:number; y:number; w:number; h:number },
  input: Drawing3DInput, font: any, fontBold: any, pad: number, labelH: number,
) {
  const { x, y, w, h } = cell;
  page.drawRectangle({ x, y: y+h-labelH, width: w, height: labelH, color: C.headerBg, borderColor: C.black, borderWidth: 0.5 });
  const lbl = "NOTES & MATERIAL CALLOUT";
  page.drawText(lbl, { x: x+(w-lbl.length*5.4)/2, y: y+h-labelH+5, size: 8, font: fontBold, color: C.black });

  let cy = y + h - labelH - pad - 10;
  const defaultNotes = [
    "ALL DIMENSIONS IN INCHES UNLESS OTHERWISE NOTED.",
    "TOLERANCES: \xB11/8\" OUTSIDE DIMS; \xB11/16\" CAVITIES.",
    "DO NOT SCALE DRAWING.",
    "FOAM ORIENTATION: RISE DIRECTION AS SHOWN.",
    "HIDDEN LINES SHOWN DASHED (CAVITIES).",
  ];
  const notes = (input.notes && input.notes.length > 0) ? input.notes : defaultNotes;

  page.drawText("GENERAL NOTES:", { x: x+pad, y: cy, size: 7, font: fontBold, color: C.black });
  cy -= 11;
  for (let i = 0; i < notes.length; i++) {
    page.drawText(`${i+1}.  ${notes[i]}`, { x: x+pad+4, y: cy, size: 6.5, font, color: C.black });
    cy -= 10;
  }
  cy -= 10;
  page.drawText("MATERIAL CALLOUT:", { x: x+pad, y: cy, size: 7, font: fontBold, color: C.black });
  cy -= 11;
  for (let i = 0; i < input.layers.length; i++) {
    const layer = input.layers[i];
    page.drawText(`LAYER ${i+1}  (${layer.thicknessIn.toFixed(3)}")  \u2013  ${layer.materialName||"FOAM"}`,
      { x: x+pad+4, y: cy, size: 6.5, font, color: C.black });
    cy -= 10;
  }
}

// ─── FRONT VIEW (X × Z, looking along +Y) ────────────────────────────────────
// Dims are placed OUTSIDE the drawn shape with proper extension lines.

function drawFrontView(
  page: PDFPage, vx:number, vy:number, vw:number, vh:number,
  block: Block3D, layers: Layer3D[], font: any,
) {
  // Reserve space for dim lines outside the shape
  const DIM_GAP  = 8;   // gap between shape edge and extension line start
  const DIM_REACH = 20; // how far the dim line sits from shape edge

  const drawableW = vw - DIM_REACH - DIM_GAP - 30; // left label space
  const drawableH = vh - DIM_REACH - DIM_GAP;

  const scale = Math.min(drawableW / block.lengthIn, drawableH / block.heightIn) * 0.88;
  const dW = block.lengthIn * scale;
  const dH = block.heightIn * scale;

  // Position shape: centred horizontally with extra left margin for labels,
  // vertically centred in the drawable zone (above the horizontal dim line space)
  const shapeX = vx + 28 + (drawableW - dW) / 2;
  const shapeY = vy + DIM_REACH + DIM_GAP + (drawableH - dH) / 2;

  crosshair(page, shapeX + dW/2, shapeY + dH/2, 12);

  // Layer bands
  let cz = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const lh = layer.thicknessIn * scale;
    const ly = shapeY + cz * scale;

    page.drawRectangle({ x: shapeX, y: ly, width: dW, height: lh,
      color: i % 2 === 0 ? C.foam : C.foamAlt,
      borderColor: C.dimLine, borderWidth: 0.6 });

    // Layer label left of shape
    const lbl = layer.label || `L${i+1}`;
    page.drawText(lbl, { x: shapeX - 22, y: ly + lh/2 - 3, size: 6, font, color: C.black });

    // Cavity cross-sections (dashed, depth from top of layer)
    for (const cav of layer.cavities) {
      const cx  = shapeX + cav.x * block.lengthIn * scale;
      const cw  = cav.lengthIn * scale;
      const cdh = Math.min(cav.depthIn, layer.thicknessIn) * scale;
      dashedRect(page, cx, ly + lh - cdh, cw, cdh, C.cavityLine, 0.75);
    }
    cz += layer.thicknessIn;
  }

  // Heavy outer border
  page.drawRectangle({ x: shapeX, y: shapeY, width: dW, height: dH,
    borderColor: C.black, borderWidth: 1.75 });

  // Dimension lines — positioned outside the shape
  const hDimY  = shapeY - DIM_GAP - DIM_REACH + 6;
  const vDimX  = shapeX + dW + DIM_GAP + DIM_REACH - 6;

  horizDim(page, shapeX, shapeX + dW, shapeY, hDimY, block.lengthIn, font);
  vertDim(page,  shapeY, shapeY + dH, shapeX + dW, vDimX, block.heightIn, font);
}

// ─── TOP VIEW (X × Y, looking down -Z) ───────────────────────────────────────

function drawTopView(
  page: PDFPage, vx:number, vy:number, vw:number, vh:number,
  block: Block3D, layers: Layer3D[], font: any,
) {
  const DIM_GAP   = 8;
  const DIM_REACH = 20;

  const drawableW = vw - DIM_REACH - DIM_GAP;
  const drawableH = vh - DIM_REACH - DIM_GAP;

  const scale = Math.min(drawableW / block.lengthIn, drawableH / block.widthIn) * 0.88;
  const dW = block.lengthIn * scale;
  const dH = block.widthIn * scale;

  const shapeX = vx + (drawableW - dW) / 2;
  const shapeY = vy + DIM_REACH + DIM_GAP + (drawableH - dH) / 2;

  crosshair(page, shapeX + dW/2, shapeY + dH/2, 12);

  page.drawRectangle({ x: shapeX, y: shapeY, width: dW, height: dH,
    color: C.foam, borderColor: C.black, borderWidth: 1.75 });

  // Cavity outlines (plan view, dashed)
  for (const layer of layers) {
    for (const cav of layer.cavities) {
      if (cav.shape === "circle") {
        const diam = cav.diameterIn || Math.min(cav.lengthIn, cav.widthIn);
        const r  = (diam / 2) * scale;
        const cx = shapeX + (cav.x + cav.lengthIn/2) * block.lengthIn * scale;
        const cy = shapeY + dH - (cav.y + cav.widthIn/2) * block.widthIn * scale;
        page.drawCircle({ x: cx, y: cy, size: r, borderColor: C.cavityLine, borderWidth: 0.75, borderDashArray: [3,2] });
      } else {
        const cx = shapeX + cav.x * block.lengthIn * scale;
        const cy = shapeY + dH - (cav.y + cav.widthIn) * block.widthIn * scale;
        dashedRect(page, cx, cy, cav.lengthIn*scale, cav.widthIn*scale, C.cavityLine, 0.75);
      }
    }
  }

  const hDimY = shapeY - DIM_GAP - DIM_REACH + 6;
  const vDimX = shapeX - DIM_GAP - DIM_REACH + 6;

  horizDim(page, shapeX, shapeX + dW, shapeY, hDimY, block.lengthIn, font);
  vertDim(page, shapeY, shapeY + dH, shapeX, vDimX, block.widthIn, font);
}

// ─── ISOMETRIC VIEW ───────────────────────────────────────────────────────────
//
// Standard 30° axonometric (cabinet), depth foreshortened 0.5×.
// Faces are filled using horizontal scan-lines within each projected trapezoid,
// which avoids the bleed-outside problem of the fan-of-lines approach.

type Pt = { x:number; y:number };

function isoProject(wx:number, wy:number, wz:number, sc:number): Pt {
  const ang   = Math.PI / 6; // 30°
  const depth = 0.5;
  return {
    x:  wx * sc - wy * Math.cos(ang) * sc * depth,
    y:  wz * sc - wy * Math.sin(ang) * sc * depth,
  };
}

// Fill a convex quad by drawing horizontal scan-lines between its left and right edges.
// pts must be in order: [top-left, top-right, bottom-right, bottom-left] in screen space
// (i.e., y increases downward is fine since pdf-lib has y up — we just need left/right pairs)
function fillIsoQuad(page: PDFPage, pts: Pt[], color: ReturnType<typeof rgb>) {
  if (pts.length < 3) return;

  // Find vertical extent
  const ys = pts.map(p => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const steps = Math.ceil(Math.abs(yMax - yMin)) + 2;
  if (steps <= 0) return;

  const n = pts.length;

  // For each scanline y, find x values where it intersects polygon edges
  for (let s = 0; s <= steps; s++) {
    const scanY = yMin + (s / steps) * (yMax - yMin);
    const xs: number[] = [];

    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
        const t  = (scanY - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }

    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const lineW = xs[xs.length - 1] - xs[0];
    if (lineW <= 0) continue;

    // Draw a filled horizontal segment at this scanline
    page.drawLine({
      start: { x: xs[0], y: scanY },
      end:   { x: xs[xs.length - 1], y: scanY },
      thickness: (yMax - yMin) / steps + 1.5, // slightly overlap to avoid gaps
      color,
    });
  }
}

function drawIsoView(
  page: PDFPage, vx:number, vy:number, vw:number, vh:number,
  block: Block3D, layers: Layer3D[], font: any,
) {
  const L = block.lengthIn, W = block.widthIn, Z = block.heightIn;
  const ang = Math.PI / 6;

  // Projected bounding box of the full block
  const projW = L + W * Math.cos(ang) * 0.5;
  const projH = Z + W * Math.sin(ang) * 0.5;
  const marg  = 30;
  const sc = Math.min((vw - 2*marg) / projW, (vh - 2*marg) / projH) * 0.82;

  // Centre: translate so midpoint of block lands at centre of viewport
  const mid = isoProject(L/2, W/2, Z/2, sc);
  const ox  = vx + vw/2 - mid.x;
  const oy  = vy + vh/2 - mid.y;

  function pt(wx:number, wy:number, wz:number): Pt {
    const p = isoProject(wx, wy, wz, sc);
    return { x: ox + p.x, y: oy + p.y };
  }

  // Draw faces bottom-layer first, back-to-front within each layer.
  // Order: fill right face, fill front face, then top face on last layer.
  let cz = 0;
  for (let i = 0; i < layers.length; i++) {
    const lh = layers[i].thicknessIn;
    const z0 = cz, z1 = cz + lh;

    // Right side face (Y=0→W, constant X=L)
    fillIsoQuad(page,
      [pt(L,0,z1), pt(L,W,z1), pt(L,W,z0), pt(L,0,z0)],
      C.isoRight);

    // Front face (Y=0, X=0→L)
    fillIsoQuad(page,
      [pt(0,0,z1), pt(L,0,z1), pt(L,0,z0), pt(0,0,z0)],
      C.isoFront);

    // Top face (Z=z1), only on topmost layer
    if (i === layers.length - 1) {
      fillIsoQuad(page,
        [pt(0,W,z1), pt(L,W,z1), pt(L,0,z1), pt(0,0,z1)],
        C.isoTop);
    }

    cz += lh;
  }

  // Layer separator lines on visible faces
  cz = 0;
  for (let i = 0; i < layers.length - 1; i++) {
    cz += layers[i].thicknessIn;
    // Front face separator
    page.drawLine({ start: pt(0,0,cz), end: pt(L,0,cz), thickness: 0.6, color: C.dimLine });
    // Right face separator
    page.drawLine({ start: pt(L,0,cz), end: pt(L,W,cz), thickness: 0.6, color: C.dimLine });
  }

  // Corners for clean edge drawing
  const c = {
    fbl: pt(0,0,0), fbr: pt(L,0,0), ftl: pt(0,0,Z), ftr: pt(L,0,Z),
    bbl: pt(0,W,0), bbr: pt(L,W,0), btl: pt(0,W,Z), btr: pt(L,W,Z),
  };

  const ew = 1.5;

  // Visible outer edges (solid, bold)
  // Bottom visible: front-bottom and right-bottom
  page.drawLine({ start: c.fbl, end: c.fbr, thickness: ew, color: C.black });
  page.drawLine({ start: c.fbr, end: c.bbr, thickness: ew, color: C.black });
  // Top edges
  page.drawLine({ start: c.ftl, end: c.ftr, thickness: ew, color: C.black });
  page.drawLine({ start: c.ftr, end: c.btr, thickness: ew, color: C.black });
  page.drawLine({ start: c.ftl, end: c.btl, thickness: ew, color: C.black });
  page.drawLine({ start: c.btl, end: c.btr, thickness: ew, color: C.black });
  // Visible vertical edges
  page.drawLine({ start: c.fbl, end: c.ftl, thickness: ew, color: C.black });
  page.drawLine({ start: c.fbr, end: c.ftr, thickness: ew, color: C.black });
  page.drawLine({ start: c.bbr, end: c.btr, thickness: ew, color: C.black });

  // Hidden edges (dashed, thin)
  // Back-left vertical: bbl → btl
  page.drawLine({ start: c.bbl, end: c.btl, thickness: 0.5, color: C.dimLine, dashArray: [3,3] });
  // Bottom-back: bbl → bbr
  page.drawLine({ start: c.bbl, end: c.bbr, thickness: 0.5, color: C.dimLine, dashArray: [3,3] });
  // Bottom-left: fbl → bbl
  page.drawLine({ start: c.fbl, end: c.bbl, thickness: 0.5, color: C.dimLine, dashArray: [3,3] });

  // Cavities on top face of topmost layer (dashed red)
  const topLayer = layers[layers.length - 1];
  if (topLayer) {
    for (const cav of topLayer.cavities) {
      const cx0 = cav.x * L, cy0 = cav.y * W;
      const cx1 = cx0 + cav.lengthIn, cy1 = cy0 + cav.widthIn;
      const corners = [pt(cx0,cy0,Z), pt(cx1,cy0,Z), pt(cx1,cy1,Z), pt(cx0,cy1,Z)];
      for (let i = 0; i < corners.length; i++) {
        page.drawLine({ start: corners[i], end: corners[(i+1)%corners.length],
          thickness: 0.75, color: C.cavityLine, dashArray: [3,2] });
      }
    }
  }

  // Dimension leader callouts (text with white box knockout)
  const dimOff = 8;

  // Length: along bottom-front edge
  const Lm = midPt(c.fbl, c.fbr);
  dimLabel(page, `L: ${L.toFixed(2)}"`, Lm.x - 14, Lm.y - dimOff - 9, font);

  // Width: along bottom-right edge
  const Wm = midPt(c.fbr, c.bbr);
  dimLabel(page, `W: ${W.toFixed(2)}"`, Wm.x + 4, Wm.y - dimOff - 5, font);

  // Height: along right-front vertical
  const Hm = midPt(c.fbr, c.ftr);
  dimLabel(page, `H: ${Z.toFixed(2)}"`, Hm.x + 5, Hm.y - 3, font);
}

// ─── Title block ──────────────────────────────────────────────────────────────

function titleBlock(
  page: PDFPage, x:number, y:number, w:number, h:number,
  font:any, fontBold:any,
  quoteNo:string, customerName:string|undefined,
  revision:string, date:string, title:string,
) {
  page.drawRectangle({ x, y, width: w, height: h, color: C.white, borderColor: C.black, borderWidth: 1.5 });

  const leftW = w * 0.60;
  page.drawRectangle({ x, y, width: leftW, height: h, color: C.titleBg });
  page.drawText(title, { x: x+12, y: y+h-22, size: 13, font: fontBold, color: C.titleFg });
  page.drawLine({ start: { x, y: y+h-28 }, end: { x: x+leftW, y: y+h-28 }, thickness: 0.5, color: C.gridLight });
  page.drawText(`Quote: ${quoteNo}`, { x: x+12, y: y+h-44, size: 9, font, color: C.titleFg });
  if (customerName) {
    page.drawText(`Customer: ${customerName}`, { x: x+12, y: y+h-57, size: 9, font, color: C.titleFg });
  }
  page.drawText("FOR MANUFACTURING USE ONLY \u2013 INTERNAL DOCUMENT", { x: x+12, y: y+10, size: 7, font, color: rgb(0.55,0.55,0.55) });

  const boxW = (w - leftW) / 2;
  const boxH = h / 2;
  const boxes = [
    { label: "REVISION", value: revision, bx: x+leftW,       by: y+boxH },
    { label: "DATE",     value: date,     bx: x+leftW+boxW,  by: y+boxH },
    { label: "SCALE",    value: "NTS",    bx: x+leftW,       by: y },
    { label: "SHEET",    value: "1 OF 1", bx: x+leftW+boxW,  by: y },
  ];
  for (const box of boxes) {
    page.drawRectangle({ x: box.bx, y: box.by, width: boxW, height: boxH, borderColor: C.black, borderWidth: 0.5 });
    page.drawRectangle({ x: box.bx, y: box.by+boxH-14, width: boxW, height: 14, color: C.headerBg });
    page.drawText(box.label, { x: box.bx+4, y: box.by+boxH-11, size: 6.5, font: fontBold, color: C.black });
    page.drawText(box.value, { x: box.bx+4, y: box.by+8, size: 10, font: fontBold, color: C.black });
  }
}

// ─── Dimension helpers ────────────────────────────────────────────────────────
// horizDim / vertDim now take both the shape edge (for extension line start)
// and the dim line position (where the actual arrow/text sits).

function horizDim(
  page: PDFPage,
  x1: number, x2: number,   // shape left/right X
  shapeBottomY: number,      // shape bottom edge Y (extension line start)
  dimY: number,              // where the dim line sits (below shape)
  val: number, font: any,
) {
  const col = C.dimLine;
  const asz = 4;

  // Extension lines (from shape edge down to dim line, with small gap)
  page.drawLine({ start: { x: x1, y: shapeBottomY - 3 }, end: { x: x1, y: dimY + 4 }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x2, y: shapeBottomY - 3 }, end: { x: x2, y: dimY + 4 }, thickness: 0.5, color: col });

  // Dim line
  page.drawLine({ start: { x: x1, y: dimY }, end: { x: x2, y: dimY }, thickness: 0.5, color: col });

  // Arrowheads
  page.drawLine({ start: { x: x1, y: dimY }, end: { x: x1+asz, y: dimY+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x1, y: dimY }, end: { x: x1+asz, y: dimY-asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x2, y: dimY }, end: { x: x2-asz, y: dimY+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x2, y: dimY }, end: { x: x2-asz, y: dimY-asz }, thickness: 0.5, color: col });

  // Text with white knockout background ON the dim line
  const txt = `${val.toFixed(2)}"`;
  const tw  = txt.length * 4.8;
  const mx  = (x1 + x2) / 2;
  page.drawRectangle({ x: mx-tw/2-2, y: dimY-5, width: tw+4, height: 10, color: C.white });
  page.drawText(txt, { x: mx-tw/2, y: dimY-3, size: 7.5, font, color: C.black });
}

function vertDim(
  page: PDFPage,
  y1: number, y2: number,    // shape bottom/top Y
  shapeEdgeX: number,        // shape edge X (extension line start)
  dimX: number,              // where the dim line sits
  val: number, font: any,
) {
  const col = C.dimLine;
  const asz = 4;

  // Extension lines
  page.drawLine({ start: { x: shapeEdgeX + 3, y: y1 }, end: { x: dimX - 4, y: y1 }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: shapeEdgeX + 3, y: y2 }, end: { x: dimX - 4, y: y2 }, thickness: 0.5, color: col });

  // Dim line
  page.drawLine({ start: { x: dimX, y: y1 }, end: { x: dimX, y: y2 }, thickness: 0.5, color: col });

  // Arrowheads
  page.drawLine({ start: { x: dimX, y: y1 }, end: { x: dimX-asz, y: y1+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: dimX, y: y1 }, end: { x: dimX+asz, y: y1+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: dimX, y: y2 }, end: { x: dimX-asz, y: y2-asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: dimX, y: y2 }, end: { x: dimX+asz, y: y2-asz }, thickness: 0.5, color: col });

  // Text with white knockout ON the dim line
  const txt = `${val.toFixed(2)}"`;
  const my  = (y1 + y2) / 2;
  const tw  = txt.length * 4.8;
  page.drawRectangle({ x: dimX-tw/2-2, y: my-5, width: tw+4, height: 10, color: C.white });
  page.drawText(txt, { x: dimX-tw/2, y: my-3, size: 7.5, font, color: C.black });
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function dashedRect(page: PDFPage, x:number, y:number, w:number, h:number, color: ReturnType<typeof rgb>, thickness:number) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: thickness, borderDashArray: [3,2] });
}

function crosshair(page: PDFPage, cx:number, cy:number, sz:number) {
  page.drawLine({ start: { x: cx-sz, y: cy }, end: { x: cx+sz, y: cy }, thickness: 0.35, color: C.crosshair, dashArray: [2,2] });
  page.drawLine({ start: { x: cx, y: cy-sz }, end: { x: cx, y: cy+sz }, thickness: 0.35, color: C.crosshair, dashArray: [2,2] });
  page.drawCircle({ x: cx, y: cy, size: 2, borderColor: C.crosshair, borderWidth: 0.35 });
}

function midPt(a: Pt, b: Pt): Pt { return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }; }

function dimLabel(page: PDFPage, txt: string, tx: number, ty: number, font: any) {
  const tw = txt.length * 4.8;
  page.drawRectangle({ x: tx-2, y: ty-1, width: tw+4, height: 10, color: C.white });
  page.drawText(txt, { x: tx, y: ty+1, size: 7.5, font, color: C.dimLine });
}