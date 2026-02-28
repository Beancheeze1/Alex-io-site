// lib/pdf/threeview.ts
//
// CAD-style orthographic drawing: ONE PAGE PER LAYER.
//
// Supports all cavity shapes from layoutTypes.ts:
//   rect        — plain rectangle
//   roundedRect — rounded corners (cornerRadiusIn)
//   circle      — circle / ellipse
//   poly        — arbitrary polygon (normalised 0-1 points[])
//
// Supports block/layer modifiers:
//   block.cornerStyle="chamfer" + block.chamferIn — diagonal corner cuts
//   layer.roundCorners + layer.roundRadiusIn      — rounded outer layer edge
//
// Each page layout (landscape 11×8.5):
//   ┌────────────────────────────────────────────────┐
//   │  FRONT VIEW (L×H) │ TOP VIEW (L×W) │ RIGHT (W×H) │
//   ├────────────────────────────────────────────────┤
//   │  NOTES & MATERIAL CALLOUT                      │
//   ├────────────────────────────────────────────────┤
//   │  TITLE BLOCK                                   │
//   └────────────────────────────────────────────────┘

import { PDFDocument, PDFPage, rgb, StandardFonts } from "pdf-lib";

// ─── Public types (mirrors layoutTypes.ts) ───────────────────────────────────

export type Block3D = {
  lengthIn:      number;
  widthIn:       number;
  heightIn:      number;
  // Block corner modifiers
  cornerStyle?:  "square" | "chamfer";
  chamferIn?:    number;
  roundCorners?: boolean;
  roundRadiusIn?: number;
};

export type Cavity3D = {
  id:             string;
  shape:          "rect" | "circle" | "roundedRect" | "poly";
  x:              number;        // 0-1 normalised from left
  y:              number;        // 0-1 normalised from top
  lengthIn:       number;
  widthIn:        number;
  depthIn:        number;
  cornerRadiusIn?: number;
  diameterIn?:    number;
  points?:        Array<{ x: number; y: number }>;
  nestedCavities?: Array<{ points: Array<{ x: number; y: number }> }>;
  label?:         string;
};

export type Layer3D = {
  id:             string;
  label?:         string;
  thicknessIn:    number;
  materialName?:  string;
  cavities:       Cavity3D[];
  // Layer outer-shape modifiers
  cropCorners?:   boolean;
  roundCorners?:  boolean;
  roundRadiusIn?: number;
};

export type Drawing3DInput = {
  quoteNo:        string;
  customerName?:  string;
  block:          Block3D;
  layers:         Layer3D[];
  revision?:      string;
  date?:          string;
  notes?:         string[];
};

// ─── Colours ──────────────────────────────────────────────────────────────────

const C = {
  black:      rgb(0,    0,    0),
  white:      rgb(1,    1,    1),
  dimLine:    rgb(0.20, 0.20, 0.20),
  foam:       rgb(0.93, 0.93, 0.93),
  cavityLine: rgb(0.70, 0,    0),
  titleBg:    rgb(0.10, 0.10, 0.10),
  titleFg:    rgb(1,    1,    1),
  headerBg:   rgb(0.84, 0.84, 0.84),
  gridLight:  rgb(0.75, 0.75, 0.75),
};

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generate3ViewPDF(input: Drawing3DInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const { block, layers } = input;

  const PW = 792, PH = 612;

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const numPages = layers.length;

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const page  = pdfDoc.addPage([PW, PH]);

    const MARGIN  = 24;
    const TITLE_H = 80;
    const NOTES_H = 130;
    const HDR_H   = 18;

    const frameX = MARGIN;
    const frameY = MARGIN + TITLE_H;
    const frameW = PW - 2 * MARGIN;
    const frameH = PH - 2 * MARGIN - TITLE_H;

    // Views area sits above notes panel
    const viewsH = frameH - NOTES_H;
    const viewsY = frameY + NOTES_H;
    const colW   = frameW / 3;
    const drawH  = viewsH - HDR_H;

    // Outer border
    page.drawRectangle({
      x: MARGIN, y: MARGIN, width: PW - 2*MARGIN, height: PH - 2*MARGIN,
      borderColor: C.black, borderWidth: 2,
    });

    // Column header bar
    const hdrY = viewsY + drawH;
    const colTitles = [
      "FRONT VIEW  (L \xD7 H)",
      "TOP VIEW  (L \xD7 W)",
      "RIGHT VIEW  (W \xD7 H)",
    ];
    for (let ci = 0; ci < 3; ci++) {
      page.drawRectangle({
        x: frameX + ci*colW, y: hdrY, width: colW, height: HDR_H,
        color: C.headerBg, borderColor: C.black, borderWidth: 0.5,
      });
      const lbl = colTitles[ci];
      page.drawText(lbl, {
        x: frameX + ci*colW + (colW - lbl.length*5.1)/2, y: hdrY + 5,
        size: 7.5, font: fontBold, color: C.black,
      });
    }

    // Vertical column dividers
    page.drawLine({ start:{x:frameX+colW,   y:frameY+NOTES_H}, end:{x:frameX+colW,   y:hdrY+HDR_H}, thickness:0.75, color:C.black });
    page.drawLine({ start:{x:frameX+2*colW, y:frameY+NOTES_H}, end:{x:frameX+2*colW, y:hdrY+HDR_H}, thickness:0.75, color:C.black });

    // Divider between views and notes
    page.drawLine({ start:{x:frameX, y:frameY+NOTES_H}, end:{x:frameX+frameW, y:frameY+NOTES_H}, thickness:0.75, color:C.black });

    // Three views
    drawFrontView (page, frameX,          viewsY, colW, drawH, block, layer, font);
    drawTopView   (page, frameX + colW,   viewsY, colW, drawH, block, layer, font);
    drawRightView (page, frameX + 2*colW, viewsY, colW, drawH, block, layer, font);

    // Notes panel
    notesPanel(page, frameX, frameY, frameW, NOTES_H, input, layer, li, numPages, font, fontBold);

    // Title block
    titleBlock(page, frameX, MARGIN, frameW, TITLE_H, font, fontBold,
      input.quoteNo, input.customerName,
      input.revision || "AS",
      input.date || new Date().toISOString().split("T")[0],
      "FOAM INSERT \u2013 TECHNICAL DRAWING",
      `${li + 1} OF ${numPages}`);
  }

  return Buffer.from(await pdfDoc.save());
}

// ─── Shape drawing helpers ────────────────────────────────────────────────────
// All shapes are drawn using pdf-lib primitives.
// pdf-lib doesn't support arbitrary SVG paths, so we approximate curves
// with small line segments for rounded rects and polygons.

type Pt = { x: number; y: number };

/** Draw a rectangle with optional rounded corners using line segments */
function drawRoundedRectOutline(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  r: number,
  color: ReturnType<typeof rgb>,
  lineWidth: number,
  dashed: boolean = false,
) {
  // Clamp radius
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r <= 0) {
    // Plain rect
    if (dashed) {
      page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: lineWidth, borderDashArray: [3, 2] });
    } else {
      page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: lineWidth });
    }
    return;
  }

  // Build polygon approximation of rounded rect (8 arcs × ~8 segments each)
  const pts = roundedRectPts(x, y, w, h, r, 8);
  drawPolyLine(page, pts, true, color, lineWidth, dashed);
}

/** Generate points for a rounded rectangle */
function roundedRectPts(x: number, y: number, w: number, h: number, r: number, segs: number): Pt[] {
  const pts: Pt[] = [];
  // Four corners: [cx, cy, startAngle]
  const corners: [number, number, number][] = [
    [x + r,     y + r,     Math.PI,       ], // top-left
    [x + w - r, y + r,     Math.PI * 1.5, ], // top-right
    [x + w - r, y + h - r, 0,             ], // bottom-right
    [x + r,     y + h - r, Math.PI * 0.5, ], // bottom-left
  ];
  for (const [cx, cy, startAng] of corners) {
    for (let s = 0; s <= segs; s++) {
      const ang = startAng + (s / segs) * (Math.PI / 2);
      pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
    }
  }
  return pts;
}

/** Draw a chamfered rectangle outline (diagonal cuts on specified corners) */
function drawChamferedRectOutline(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  chamferX: number, chamferY: number,
  color: ReturnType<typeof rgb>, lineWidth: number, dashed: boolean = false,
) {
  // Only chamfer top-left and bottom-right (matching the canvas impl)
  const pts: Pt[] = [
    { x: x + chamferX,     y },               // top edge start (after TL chamfer)
    { x: x + w,            y },               // top-right
    { x: x + w,            y: y + h - chamferY }, // before BR chamfer
    { x: x + w - chamferX, y: y + h },        // BR chamfer end
    { x,                   y: y + h },        // bottom-left
    { x,                   y: y + chamferY }, // before TL chamfer
  ];
  drawPolyLine(page, pts, true, color, lineWidth, dashed);
}

/** Draw connected line segments through pts; close=true closes the loop */
function drawPolyLine(
  page: PDFPage, pts: Pt[], close: boolean,
  color: ReturnType<typeof rgb>, lineWidth: number, dashed: boolean = false,
) {
  if (pts.length < 2) return;
  const all = close ? [...pts, pts[0]] : pts;
  const da: number[] | undefined = dashed ? [3, 2] : undefined;
  for (let i = 0; i < all.length - 1; i++) {
    page.drawLine({
      start: all[i], end: all[i + 1],
      thickness: lineWidth, color,
      ...(da ? { dashArray: da } : {}),
    });
  }
}

/** Fill a region with foam colour using horizontal scanlines (for non-rect shapes) */
function fillPolyWithScanlines(page: PDFPage, pts: Pt[], color: ReturnType<typeof rgb>) {
  if (pts.length < 3) return;

  const ys = pts.map(p => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const steps = Math.ceil(yMax - yMin) + 2;
  if (steps <= 0) return;
  const n = pts.length;

  for (let s = 0; s <= steps; s++) {
    const scanY = yMin + (s / steps) * (yMax - yMin);
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
        const t = (scanY - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const lineW = xs[xs.length - 1] - xs[0];
    if (lineW <= 0) continue;
    page.drawLine({
      start: { x: xs[0], y: scanY },
      end:   { x: xs[xs.length - 1], y: scanY },
      thickness: (yMax - yMin) / steps + 1.5,
      color,
    });
  }
}

// ─── Block outer shape helpers ────────────────────────────────────────────────

/**
 * Draw the outer foam block outline in a given view.
 * Handles: plain rect, chamfered corners (block.cornerStyle="chamfer"),
 * and rounded outer edges (layer.roundCorners).
 *
 * For front/right views the block is always a plain rect (shape modifiers
 * only apply to the top-face plan). We draw plain rect for those.
 */
function drawBlockOutline(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  block: Block3D, layer: Layer3D,
  isPlanView: boolean, // true = top view (X/Y plan), false = elevation
) {
  // Fill first (scanline for non-rect, plain for rect)
  if (isPlanView && layer.roundCorners && layer.roundRadiusIn && layer.roundRadiusIn > 0) {
    const rPx = Math.min(
      layer.roundRadiusIn * (w / block.lengthIn),
      w / 2 - 0.5, h / 2 - 0.5,
    );
    const pts = roundedRectPts(x, y, w, h, rPx, 12);
    fillPolyWithScanlines(page, pts, C.foam);
    drawRoundedRectOutline(page, x, y, w, h, rPx, C.black, 1.5);
  } else if (isPlanView && block.cornerStyle === "chamfer" && block.chamferIn && block.chamferIn > 0) {
    const cX = block.chamferIn * (w / block.lengthIn);
    const cY = block.chamferIn * (h / block.widthIn);
    const pts: Pt[] = [
      { x: x + cX,     y },
      { x: x + w,      y },
      { x: x + w,      y: y + h - cY },
      { x: x + w - cX, y: y + h },
      { x,             y: y + h },
      { x,             y: y + cY },
    ];
    fillPolyWithScanlines(page, pts, C.foam);
    drawChamferedRectOutline(page, x, y, w, h, cX, cY, C.black, 1.5);
  } else {
    // Plain rectangle
    page.drawRectangle({ x, y, width: w, height: h, color: C.foam, borderColor: C.black, borderWidth: 1.5 });
  }
}

// ─── Cavity drawing in a view ─────────────────────────────────────────────────

/**
 * Draw a cavity in the TOP VIEW (plan, X/Y).
 * All shape types rendered faithfully.
 */
function drawCavityTopView(
  page: PDFPage,
  cav: Cavity3D,
  sx: number, sy: number,   // shape origin (top-left of block rect in PDF coords)
  sW: number, sH: number,   // block drawn width/height
  blockL: number, blockW: number,
) {
  const scaleX = sW / blockL;
  const scaleY = sH / blockW;

  if (cav.shape === "circle") {
    const diam   = cav.diameterIn || Math.min(cav.lengthIn, cav.widthIn);
    const rx     = (cav.lengthIn  / 2) * scaleX;
    const ry     = (cav.widthIn   / 2) * scaleY;
    const cx     = sx + (cav.x + cav.lengthIn / 2) * scaleX * blockL;
    const cy     = sy + sH - (cav.y + cav.widthIn / 2) * scaleY * blockW;
    // Use circle if rx ≈ ry, else approximate ellipse
    const r = Math.min(rx, ry);
    page.drawCircle({ x: cx, y: cy, size: r, borderColor: C.cavityLine, borderWidth: 0.9, borderDashArray: [3, 2] });

  } else if (cav.shape === "roundedRect") {
    const cavX = sx + cav.x * scaleX * blockL;
    const cavY = sy + sH - (cav.y + cav.widthIn) * scaleY * blockW;
    const cavW = cav.lengthIn * scaleX;
    const cavH = cav.widthIn  * scaleY;
    const rPx  = Math.min(
      (cav.cornerRadiusIn || 0) * Math.min(scaleX, scaleY),
      cavW / 2 - 0.5, cavH / 2 - 0.5,
    );
    drawRoundedRectOutline(page, cavX, cavY, cavW, cavH, rPx, C.cavityLine, 0.9, true);

  } else if (cav.shape === "poly" && Array.isArray(cav.points) && cav.points.length >= 3) {
    // points are in 0-1 space relative to the block face
    const pts = cav.points.map(p => ({
      x: sx + p.x * sW,
      y: sy + p.y * sH,
    }));
    drawPolyLine(page, pts, true, C.cavityLine, 0.9, true);

    // Nested cavities (holes within the cavity)
    if (cav.nestedCavities) {
      for (const nested of cav.nestedCavities) {
        if (!nested.points || nested.points.length < 3) continue;
        const npts = nested.points.map(p => ({
          x: sx + p.x * sW,
          y: sy + p.y * sH,
        }));
        drawPolyLine(page, npts, true, C.cavityLine, 0.7, true);
      }
    }

  } else {
    // Plain rect
    const cavX = sx + cav.x * scaleX * blockL;
    const cavY = sy + sH - (cav.y + cav.widthIn) * scaleY * blockW;
    const cavW = cav.lengthIn * scaleX;
    const cavH = cav.widthIn  * scaleY;
    page.drawRectangle({ x: cavX, y: cavY, width: cavW, height: cavH,
      borderColor: C.cavityLine, borderWidth: 0.9, borderDashArray: [3, 2] });
  }
}

/**
 * Draw a cavity in FRONT VIEW (X/Z elevation — length vs depth).
 * All shapes appear as a dashed rectangle (their cross-section depth profile).
 * Poly cavities use a simplified bounding rect since we don't have depth points.
 */
function drawCavityFrontView(
  page: PDFPage,
  cav: Cavity3D,
  sx: number, sy: number, sW: number, sH: number,
  blockL: number, layerThk: number,
) {
  const scaleX = sW / blockL;
  const scaleZ = sH / layerThk;

  let cavX: number, cavW: number;

  if (cav.shape === "poly" && Array.isArray(cav.points) && cav.points.length >= 3) {
    // Bounding box of poly in X direction
    const xs = cav.points.map(p => p.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    cavX = sx + minX * sW;
    cavW = (maxX - minX) * sW;
  } else if (cav.shape === "circle") {
    const r = (cav.lengthIn / 2) * scaleX;
    cavX = sx + cav.x * scaleX * blockL + (cav.lengthIn / 2 - cav.lengthIn / 2) * scaleX;
    cavW = cav.lengthIn * scaleX;
    // Draw circle cross-section as a centred dashed rect
    const cx = sx + (cav.x + cav.lengthIn / 2) * scaleX * blockL;
    cavX = cx - r;
    cavW = r * 2;
  } else {
    cavX = sx + cav.x * scaleX * blockL;
    cavW = cav.lengthIn * scaleX;
  }

  const cavH = Math.min(cav.depthIn, layerThk) * scaleZ;
  const cavY = sy + sH - cavH;

  page.drawRectangle({ x: cavX, y: cavY, width: Math.max(cavW, 1), height: Math.max(cavH, 1),
    borderColor: C.cavityLine, borderWidth: 0.9, borderDashArray: [3, 2] });

  return { cavX, cavY, cavW, cavH };
}

/**
 * Draw a cavity in RIGHT VIEW (Y/Z elevation — width vs depth).
 */
function drawCavityRightView(
  page: PDFPage,
  cav: Cavity3D,
  sx: number, sy: number, sW: number, sH: number,
  blockW: number, layerThk: number,
) {
  const scaleY = sW / blockW;
  const scaleZ = sH / layerThk;

  let cavX: number, cavW: number;

  if (cav.shape === "poly" && Array.isArray(cav.points) && cav.points.length >= 3) {
    const ys = cav.points.map(p => p.y);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    cavX = sx + minY * sW;
    cavW = (maxY - minY) * sW;
  } else {
    cavX = sx + cav.y * scaleY * blockW;
    cavW = cav.widthIn * scaleY;
  }

  const cavH = Math.min(cav.depthIn, layerThk) * scaleZ;
  const cavY = sy + sH - cavH;

  page.drawRectangle({ x: cavX, y: cavY, width: Math.max(cavW, 1), height: Math.max(cavH, 1),
    borderColor: C.cavityLine, borderWidth: 0.9, borderDashArray: [3, 2] });

  return { cavX, cavY, cavW, cavH };
}

// ─── FRONT VIEW  (L × H) ──────────────────────────────────────────────────────

function drawFrontView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  const DIM = 24, LPAD = 24;

  const avW = cw - LPAD - DIM - 8;
  const avH = ch - DIM - 8;

  const scale = Math.min(avW / block.lengthIn, avH / layer.thicknessIn) * 0.82;
  const sW    = block.lengthIn * scale;
  const sH    = layer.thicknessIn * scale;

  const sx = cx + LPAD + (avW - sW) / 2;
  const sy = cy + DIM + (avH - sH) / 2;

  // Block outline (elevation = always plain rect)
  page.drawRectangle({ x:sx, y:sy, width:sW, height:sH, color:C.foam, borderColor:C.black, borderWidth:1.5 });

  // Cavities
  for (const cav of layer.cavities) {
    const { cavX, cavY, cavW, cavH } = drawCavityFrontView(
      page, cav, sx, sy, sW, sH, block.lengthIn, layer.thicknessIn);

    if (cavW > 20) {
      horizDim(page, cavX, cavX+cavW, cavY, cy + DIM*0.4, cav.lengthIn, font, 6);
    }
    if (cavH > 14 && cavX + cavW + DIM < cx + cw - 4) {
      vertDim(page, cavY, cavY+cavH, cavX+cavW, cavX+cavW+DIM-4, cav.depthIn, font, 6);
    }
  }

  horizDim(page, sx, sx+sW, sy, sy - DIM + 4, block.lengthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx+sW, sx+sW+DIM-4, layer.thicknessIn, font, 7.5);
}

// ─── TOP VIEW  (L × W, plan) ──────────────────────────────────────────────────

function drawTopView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  const DIM = 24;

  const avW = cw - DIM - 8;
  const avH = ch - DIM - 8;

  const scale = Math.min(avW / block.lengthIn, avH / block.widthIn) * 0.82;
  const sW    = block.lengthIn * scale;
  const sH    = block.widthIn * scale;

  const sx = cx + (avW - sW) / 2;
  const sy = cy + DIM + (avH - sH) / 2;

  // Block outline — shows corner modifiers
  drawBlockOutline(page, sx, sy, sW, sH, block, layer, true);

  // Cavities
  for (const cav of layer.cavities) {
    drawCavityTopView(page, cav, sx, sy, sW, sH, block.lengthIn, block.widthIn);

    // Add dims for standard shapes
    if (cav.shape !== "poly") {
      const cavX = sx + cav.x * (sW / block.lengthIn) * block.lengthIn;
      const cavY = sy + sH - (cav.y + cav.widthIn) * (sH / block.widthIn);
      const cavW = cav.lengthIn * (sW / block.lengthIn);
      const cavH = cav.widthIn  * (sH / block.widthIn);

      if (cav.shape === "circle") {
        const r = Math.min(cavW, cavH) / 2;
        const ccx = sx + (cav.x + cav.lengthIn/2) * (sW / block.lengthIn);
        const ccy = sy + sH - (cav.y + cav.widthIn/2) * (sH / block.widthIn);
        if (r * 2 > 14) {
          horizDim(page, ccx - r, ccx + r, ccy, ccy - DIM + 4,
            cav.diameterIn || cav.lengthIn, font, 6);
        }
      } else {
        if (cavW > 20) horizDim(page, cavX, cavX+cavW, cavY, cy + DIM*0.4, cav.lengthIn, font, 6);
        if (cavH > 14) vertDim (page, cavY, cavY+cavH, cavX, cx + 4, cav.widthIn, font, 6);
      }
    }
  }

  horizDim(page, sx, sx+sW, sy, sy - DIM + 4, block.lengthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx, cx + 4, block.widthIn, font, 7.5);
}

// ─── RIGHT VIEW  (W × H) ──────────────────────────────────────────────────────

function drawRightView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  const DIM = 24, RPAD = 6;

  const avW = cw - DIM - RPAD - 8;
  const avH = ch - DIM - 8;

  const scale = Math.min(avW / block.widthIn, avH / layer.thicknessIn) * 0.82;
  const sW    = block.widthIn * scale;
  const sH    = layer.thicknessIn * scale;

  const sx = cx + (avW - sW) / 2;
  const sy = cy + DIM + (avH - sH) / 2;

  page.drawRectangle({ x:sx, y:sy, width:sW, height:sH, color:C.foam, borderColor:C.black, borderWidth:1.5 });

  for (const cav of layer.cavities) {
    const { cavX, cavY, cavW, cavH } = drawCavityRightView(
      page, cav, sx, sy, sW, sH, block.widthIn, layer.thicknessIn);

    if (cavW > 20) horizDim(page, cavX, cavX+cavW, cavY, cy + DIM*0.4, cav.widthIn, font, 6);
    if (cavH > 14 && cavX + cavW + DIM < cx + cw - 4) {
      vertDim(page, cavY, cavY+cavH, cavX+cavW, cavX+cavW+DIM-4, cav.depthIn, font, 6);
    }
  }

  horizDim(page, sx, sx+sW, sy, sy - DIM + 4, block.widthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx+sW, sx+sW+DIM-4, layer.thicknessIn, font, 7.5);
}

// ─── Notes & Material Callout Panel ──────────────────────────────────────────

function notesPanel(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  input: Drawing3DInput, layer: Layer3D,
  layerIdx: number, totalLayers: number,
  font: any, fontBold: any,
) {
  const LABEL_H = 18, PAD = 10;

  page.drawRectangle({ x, y: y+h-LABEL_H, width: w, height: LABEL_H,
    color: C.headerBg, borderColor: C.black, borderWidth: 0.5 });
  const lbl = "NOTES & MATERIAL CALLOUT";
  page.drawText(lbl, {
    x: x + (w - lbl.length*5.4)/2, y: y+h-LABEL_H+5,
    size: 8, font: fontBold, color: C.black,
  });

  const midX  = x + w * 0.52;
  const colPad = PAD + 4;

  // Vertical divider
  page.drawLine({ start:{x:midX, y}, end:{x:midX, y:y+h-LABEL_H}, thickness:0.5, color:C.black });

  // ── Left: general notes ───────────────────────────────────────────────────
  let ly = y + h - LABEL_H - colPad - 8;
  const defaultNotes = [
    "ALL DIMENSIONS IN INCHES UNLESS OTHERWISE NOTED.",
    `TOLERANCES: \xB11/8" OUTSIDE DIMS; \xB11/16" CAVITIES.`,
    "DO NOT SCALE DRAWING.",
    "FOAM ORIENTATION: RISE DIRECTION AS SHOWN.",
    "DASHED LINES INDICATE CAVITIES / HIDDEN EDGES.",
  ];
  const notes = (input.notes && input.notes.length > 0) ? input.notes : defaultNotes;

  page.drawText("GENERAL NOTES:", { x:x+colPad, y:ly, size:7, font:fontBold, color:C.black });
  ly -= 12;
  for (let i = 0; i < notes.length; i++) {
    page.drawText(`${i+1}.  ${notes[i]}`, { x:x+colPad+4, y:ly, size:6.5, font, color:C.black });
    ly -= 10;
  }

  // ── Right: layer + cavity details ────────────────────────────────────────
  let ry = y + h - LABEL_H - colPad - 8;
  const layerName = layer.label || `Layer ${layerIdx + 1}`;

  // Layer modifiers note
  const modifiers: string[] = [];
  if (layer.roundCorners && layer.roundRadiusIn) modifiers.push(`Rounded corners (r=${layer.roundRadiusIn}")`);
  if (layer.cropCorners) modifiers.push("Chamfered corners");
  if (input.block.cornerStyle === "chamfer" && input.block.chamferIn) modifiers.push(`Block chamfer (${input.block.chamferIn}")`);

  page.drawText("LAYER DETAILS:", { x:midX+colPad, y:ry, size:7, font:fontBold, color:C.black });
  ry -= 12;

  const details: Array<[string, string]> = [
    ["Layer",     `${layerName}  (${layerIdx+1} of ${totalLayers})`],
    ["Thickness", `${layer.thicknessIn.toFixed(3)}"`],
    ["Material",  layer.materialName || "\u2014"],
    ["Block L",   `${input.block.lengthIn.toFixed(3)}"`],
    ["Block W",   `${input.block.widthIn.toFixed(3)}"`],
    ["Cavities",  layer.cavities.length > 0 ? `${layer.cavities.length}` : "None"],
    ...(modifiers.length > 0 ? [["Modifiers", modifiers.join("; ")] as [string,string]] : []),
  ];

  for (const [label, val] of details) {
    page.drawText(`${label}:`, { x:midX+colPad, y:ry, size:6.5, font:fontBold, color:C.black });
    page.drawText(val,         { x:midX+colPad+58, y:ry, size:6.5, font, color:C.black });
    ry -= 10;
  }

  // Cavity schedule table
  if (layer.cavities.length > 0) {
    ry -= 4;
    page.drawText("CAVITY SCHEDULE:", { x:midX+colPad, y:ry, size:7, font:fontBold, color:C.black });
    ry -= 11;

    const cols = [
      { label:"#",     ox:0   },
      { label:"SHAPE", ox:14  },
      { label:`L"`,    ox:60  },
      { label:`W"`,    ox:90  },
      { label:`D"`,    ox:120 },
      { label:"CORNER",ox:150 },
    ];
    for (const col of cols) {
      page.drawText(col.label, { x:midX+colPad+col.ox, y:ry, size:6, font:fontBold, color:C.black });
    }
    ry -= 2;
    page.drawLine({ start:{x:midX+colPad, y:ry}, end:{x:midX+colPad+200, y:ry}, thickness:0.4, color:C.dimLine });
    ry -= 8;

    for (let ci = 0; ci < layer.cavities.length; ci++) {
      const cav = layer.cavities[ci];
      const shapeLabel = cav.shape === "roundedRect" ? "RND RECT"
        : cav.shape === "poly" ? "POLYGON"
        : cav.shape.toUpperCase();
      const cornerLabel = cav.shape === "roundedRect" && cav.cornerRadiusIn
        ? `r=${cav.cornerRadiusIn.toFixed(3)}"` : "\u2014";

      const row = [
        String(ci+1),
        shapeLabel,
        cav.lengthIn.toFixed(3),
        cav.widthIn.toFixed(3),
        cav.depthIn.toFixed(3),
        cornerLabel,
      ];
      for (let ri = 0; ri < cols.length; ri++) {
        page.drawText(row[ri], { x:midX+colPad+cols[ri].ox, y:ry, size:6, font, color:C.black });
      }
      ry -= 9;
      if (ry < y + 6) break;
    }
  }
}

// ─── Title block ──────────────────────────────────────────────────────────────

function titleBlock(
  page: PDFPage, x:number, y:number, w:number, h:number,
  font:any, fontBold:any,
  quoteNo:string, customerName:string|undefined,
  revision:string, date:string, title:string, sheet:string,
) {
  page.drawRectangle({ x, y, width:w, height:h, color:C.white, borderColor:C.black, borderWidth:1.5 });

  const leftW = w * 0.60;
  page.drawRectangle({ x, y, width:leftW, height:h, color:C.titleBg });
  page.drawText(title, { x:x+12, y:y+h-22, size:13, font:fontBold, color:C.titleFg });
  page.drawLine({ start:{x, y:y+h-28}, end:{x:x+leftW, y:y+h-28}, thickness:0.5, color:C.gridLight });
  page.drawText(`Quote: ${quoteNo}`, { x:x+12, y:y+h-44, size:9, font, color:C.titleFg });
  if (customerName) {
    page.drawText(`Customer: ${customerName}`, { x:x+12, y:y+h-57, size:9, font, color:C.titleFg });
  }
  page.drawText("FOR MANUFACTURING USE ONLY \u2013 INTERNAL DOCUMENT",
    { x:x+12, y:y+10, size:7, font, color:rgb(0.55, 0.55, 0.55) });

  const boxW = (w - leftW) / 2, boxH = h / 2;
  for (const box of [
    { label:"REVISION", value:revision, bx:x+leftW,      by:y+boxH },
    { label:"DATE",     value:date,     bx:x+leftW+boxW, by:y+boxH },
    { label:"SCALE",    value:"NTS",    bx:x+leftW,      by:y      },
    { label:"SHEET",    value:sheet,    bx:x+leftW+boxW, by:y      },
  ]) {
    page.drawRectangle({ x:box.bx, y:box.by, width:boxW, height:boxH, borderColor:C.black, borderWidth:0.5 });
    page.drawRectangle({ x:box.bx, y:box.by+boxH-14, width:boxW, height:14, color:C.headerBg });
    page.drawText(box.label, { x:box.bx+4, y:box.by+boxH-11, size:6.5, font:fontBold, color:C.black });
    page.drawText(box.value, { x:box.bx+4, y:box.by+8,       size:10,  font:fontBold, color:C.black });
  }
}

// ─── Dimension helpers ────────────────────────────────────────────────────────

function horizDim(
  page: PDFPage, x1:number, x2:number,
  shapeEdgeY:number, dimY:number,
  val:number, font:any, textSize:number = 7.5,
) {
  if (Math.abs(x2 - x1) < 6) return;
  const col = C.dimLine, asz = 3.5;
  page.drawLine({ start:{x:x1,y:shapeEdgeY-2}, end:{x:x1,y:dimY+3}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:shapeEdgeY-2}, end:{x:x2,y:dimY+3}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x2,y:dimY}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x1+asz,y:dimY+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x1+asz,y:dimY-asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:dimY}, end:{x:x2-asz,y:dimY+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:dimY}, end:{x:x2-asz,y:dimY-asz}, thickness:0.5, color:col });
  const txt = `${val.toFixed(2)}"`;
  const tw  = txt.length * (textSize * 0.60);
  const mx  = (x1+x2)/2;
  page.drawRectangle({ x:mx-tw/2-2, y:dimY-5, width:tw+4, height:10, color:C.white });
  page.drawText(txt, { x:mx-tw/2, y:dimY-3, size:textSize, font, color:C.black });
}

function vertDim(
  page: PDFPage, y1:number, y2:number,
  shapeEdgeX:number, dimX:number,
  val:number, font:any, textSize:number = 7.5,
) {
  if (Math.abs(y2 - y1) < 6) return;
  const col = C.dimLine, asz = 3.5;
  page.drawLine({ start:{x:shapeEdgeX+2,y:y1}, end:{x:dimX-3,y:y1}, thickness:0.5, color:col });
  page.drawLine({ start:{x:shapeEdgeX+2,y:y2}, end:{x:dimX-3,y:y2}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX,y:y2}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX-asz,y:y1+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX+asz,y:y1+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y2}, end:{x:dimX-asz,y:y2-asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y2}, end:{x:dimX+asz,y:y2-asz}, thickness:0.5, color:col });
  const txt = `${val.toFixed(2)}"`;
  const my  = (y1+y2)/2;
  const tw  = txt.length * (textSize * 0.60);
  page.drawRectangle({ x:dimX-tw/2-2, y:my-5, width:tw+4, height:10, color:C.white });
  page.drawText(txt, { x:dimX-tw/2, y:my-3, size:textSize, font, color:C.black });
}