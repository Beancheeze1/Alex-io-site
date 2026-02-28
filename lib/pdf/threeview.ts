// lib/pdf/threeview.ts
//
// CAD-style orthographic drawing: ONE PAGE PER LAYER.
// Front View (L×H) | Top View (L×W) | Right View (W×H)
// Notes & Material Callout | Title Block

import { PDFDocument, PDFPage, rgb, StandardFonts } from "pdf-lib";

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

// ─── Layout constants ─────────────────────────────────────────────────────────

const PW      = 792;   // page width  (11" landscape)
const PH      = 612;   // page height (8.5" landscape)
const MARGIN  = 24;
const TITLE_H = 68;    // title block — smaller to free up notes space
const NOTES_H = 155;   // notes panel — taller to fit cavity schedule
const HDR_H   = 18;    // column header bar

// Derived
const FRAME_X = MARGIN;
const FRAME_Y = MARGIN + TITLE_H;
const FRAME_W = PW - 2 * MARGIN;
const FRAME_H = PH - 2 * MARGIN - TITLE_H;
const COL_W   = FRAME_W / 3;
const VIEWS_H = FRAME_H - NOTES_H;          // height of the 3-view zone
const VIEWS_Y = FRAME_Y + NOTES_H;          // bottom-left Y of views zone
const DRAW_H  = VIEWS_H - HDR_H;            // drawable height inside a view cell

// Inside each view cell, reserve this space for overall dimension lines
// OUTSIDE the shape: horiz dim below, vert dim to right.
// Cavity dims go INSIDE the view, adjacent to the cavity.
const DIM_OUT = 22;   // overall dim offset from shape edge
const DIM_IN  = 14;   // cavity dim offset from cavity edge (inside the cell)

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generate3ViewPDF(input: Drawing3DInput): Promise<Buffer> {
  const pdfDoc   = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { block, layers } = input;
  const numPages = layers.length;

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const page  = pdfDoc.addPage([PW, PH]);

    // ── Outer border ──
    page.drawRectangle({ x: MARGIN, y: MARGIN, width: PW-2*MARGIN, height: PH-2*MARGIN,
      borderColor: C.black, borderWidth: 2 });

    // ── Column header bar (top of views zone) ──
    const hdrY = VIEWS_Y + DRAW_H;
    for (let ci = 0; ci < 3; ci++) {
      const lbl = ["FRONT VIEW  (L \xD7 H)", "TOP VIEW  (L \xD7 W)", "RIGHT VIEW  (W \xD7 H)"][ci];
      page.drawRectangle({ x: FRAME_X+ci*COL_W, y: hdrY, width: COL_W, height: HDR_H,
        color: C.headerBg, borderColor: C.black, borderWidth: 0.5 });
      page.drawText(lbl, {
        x: FRAME_X+ci*COL_W + (COL_W - lbl.length*5.1)/2, y: hdrY+5,
        size: 7.5, font: fontBold, color: C.black,
      });
    }

    // ── Vertical column dividers ──
    page.drawLine({ start:{x:FRAME_X+COL_W,   y:FRAME_Y+NOTES_H}, end:{x:FRAME_X+COL_W,   y:hdrY+HDR_H}, thickness:0.75, color:C.black });
    page.drawLine({ start:{x:FRAME_X+2*COL_W, y:FRAME_Y+NOTES_H}, end:{x:FRAME_X+2*COL_W, y:hdrY+HDR_H}, thickness:0.75, color:C.black });

    // ── Divider between views and notes ──
    page.drawLine({ start:{x:FRAME_X, y:FRAME_Y+NOTES_H}, end:{x:FRAME_X+FRAME_W, y:FRAME_Y+NOTES_H},
      thickness:0.75, color:C.black });

    // ── Three views ──
    drawFrontView (page, FRAME_X,           VIEWS_Y, COL_W, DRAW_H, block, layer, font);
    drawTopView   (page, FRAME_X + COL_W,   VIEWS_Y, COL_W, DRAW_H, block, layer, font);
    drawRightView (page, FRAME_X + 2*COL_W, VIEWS_Y, COL_W, DRAW_H, block, layer, font);

    // ── Notes panel ──
    notesPanel(page, FRAME_X, FRAME_Y, FRAME_W, NOTES_H, input, layer, li, numPages, font, fontBold);

    // ── Title block ──
    titleBlock(page, FRAME_X, MARGIN, FRAME_W, TITLE_H, font, fontBold,
      input.quoteNo, input.customerName,
      input.revision || "AS",
      input.date || new Date().toISOString().split("T")[0],
      "FOAM INSERT \u2013 TECHNICAL DRAWING",
      `${li+1} OF ${numPages}`);
  }

  return Buffer.from(await pdfDoc.save());
}

// ─── FRONT VIEW  (L × H of this layer) ───────────────────────────────────────
// Overall dims outside the shape.
// Cavity dims: width dim just ABOVE the cavity top edge; depth dim just RIGHT of cavity.

function drawFrontView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  // Space budget:
  //   left:   LPAD for layer labels that spill left (we don't draw them now, but keep margin)
  //   bottom: DIM_OUT for overall length dim
  //   right:  DIM_OUT for overall thickness dim
  const LPAD = 8;
  const avW  = cw - LPAD - DIM_OUT - 6;
  const avH  = ch - DIM_OUT - 6;

  const scale = Math.min(avW / block.lengthIn, avH / layer.thicknessIn) * 0.82;
  const sW    = block.lengthIn * scale;
  const sH    = layer.thicknessIn * scale;

  // Centre within available area; push right by LPAD so overall vert dim doesn't clip left edge
  const sx = cx + LPAD + (avW - sW) / 2;
  const sy = cy + DIM_OUT + (avH - sH) / 2;

  // Block fill + outline
  page.drawRectangle({ x:sx, y:sy, width:sW, height:sH, color:C.foam, borderColor:C.black, borderWidth:1.5 });

  // Cavities + their dims
  for (const cav of layer.cavities) {
    const { cavX, cavY, cavW, cavH } = drawCavityFrontView(
      page, cav, sx, sy, sW, sH, block.lengthIn, layer.thicknessIn);

    // Cavity LENGTH dim: just above the cavity top edge (inside the view)
    if (cavW > 16) {
      const dimY = cavY + cavH + DIM_IN;   // above cavity top = cavY+cavH (PDF y-up)
      horizDim(page, cavX, cavX+cavW, cavY+cavH, dimY, cav.lengthIn, font, 6);
    }
    // Cavity DEPTH dim: just right of the cavity (inside the view, won't exceed right edge)
    const rightOfCav = cavX + cavW + DIM_IN;
    if (cavH > 10 && rightOfCav + 24 <= cx + cw - 2) {
      vertDim(page, cavY, cavY+cavH, cavX+cavW, rightOfCav, cav.depthIn, font, 6);
    }
  }

  // Overall dims — outside the shape
  horizDim(page, sx, sx+sW, sy, sy - DIM_OUT + 4, block.lengthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx+sW, sx+sW+DIM_OUT-4, layer.thicknessIn, font, 7.5);
}

// ─── TOP VIEW  (L × W plan) ───────────────────────────────────────────────────
// Overall dims: length below shape, width LEFT of shape (but within the column).
// Cavity dims: width dim above cavity top, height dim right of cavity.

function drawTopView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  // Reserve space:
  //   left:   DIM_OUT for overall width (vertical) dim — kept INSIDE the column
  //   right:  a little padding
  //   bottom: DIM_OUT for overall length (horiz) dim
  const LPAD = DIM_OUT + 4;   // left margin inside the column for the vert overall dim
  const RPAD = 6;
  const avW  = cw - LPAD - RPAD;
  const avH  = ch - DIM_OUT - 6;

  const scale = Math.min(avW / block.lengthIn, avH / block.widthIn) * 0.82;
  const sW    = block.lengthIn * scale;
  const sH    = block.widthIn * scale;

  // Place shape: offset right by LPAD so the vert dim fits to its left
  const sx = cx + LPAD + (avW - sW) / 2;
  const sy = cy + DIM_OUT + (avH - sH) / 2;

  drawBlockOutline(page, sx, sy, sW, sH, block, layer, true);

  // Cavities
  for (const cav of layer.cavities) {
    drawCavityTopView(page, cav, sx, sy, sW, sH, block.lengthIn, block.widthIn);

    if (cav.shape === "poly") continue; // no auto-dims for poly

    const scaleX = sW / block.lengthIn; // px per inch (L)
    const scaleY = sH / block.widthIn;  // px per inch (W)

    // cav.x / cav.y are NORMALIZED (0..1). Convert to inches on the block face.
    const cavLeftIn = cav.x * block.lengthIn;
    const cavTopIn  = cav.y * block.widthIn;

    if (cav.shape === "circle") {
      const diamIn = cav.diameterIn || Math.min(cav.lengthIn, cav.widthIn);
      const rPx    = (diamIn / 2) * Math.min(scaleX, scaleY);

      const ccx = sx + (cavLeftIn + diamIn / 2) * scaleX;
      const ccy = sy + sH - (cavTopIn + diamIn / 2) * scaleY;

      if (rPx * 2 > 12) {
        // Dim above circle
        horizDim(page, ccx - rPx, ccx + rPx, ccy + rPx, ccy + rPx + DIM_IN, diamIn, font, 6);
      }
    } else {
      const cavX = sx + cavLeftIn * scaleX;
      const cavY = sy + sH - (cavTopIn + cav.widthIn) * scaleY;
      const cavW = cav.lengthIn * scaleX;
      const cavH = cav.widthIn  * scaleY;

      // Width (L) dim just above cavity top edge
      if (cavW > 16) {
        horizDim(page, cavX, cavX+cavW, cavY+cavH, cavY+cavH+DIM_IN, cav.lengthIn, font, 6);
      }
      // Height (W) dim just right of cavity (stays within column)
      const rightOfCav = cavX + cavW + DIM_IN;
      if (cavH > 10 && rightOfCav + 24 <= cx + cw - 2) {
        vertDim(page, cavY, cavY+cavH, cavX+cavW, rightOfCav, cav.widthIn, font, 6);
      }
    }
  }

  // Overall dims
  // Length: below shape
  horizDim(page, sx, sx+sW, sy, sy - DIM_OUT + 4, block.lengthIn, font, 7.5);
  // Width: left of shape, dim line at cx + LPAD/2 (well inside the column)
  const vDimX = cx + LPAD - 4;
  vertDim(page, sy, sy+sH, sx, vDimX, block.widthIn, font, 7.5);
}

// ─── RIGHT VIEW  (W × H of this layer) ───────────────────────────────────────

function drawRightView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  const RPAD = 6;
  const avW  = cw - DIM_OUT - RPAD - 6;
  const avH  = ch - DIM_OUT - 6;

  const scale = Math.min(avW / block.widthIn, avH / layer.thicknessIn) * 0.82;
  const sW    = block.widthIn * scale;
  const sH    = layer.thicknessIn * scale;

  const sx = cx + (avW - sW) / 2;
  const sy = cy + DIM_OUT + (avH - sH) / 2;

  page.drawRectangle({ x:sx, y:sy, width:sW, height:sH, color:C.foam, borderColor:C.black, borderWidth:1.5 });

  for (const cav of layer.cavities) {
    const { cavX, cavY, cavW, cavH } = drawCavityRightView(
      page, cav, sx, sy, sW, sH, block.widthIn, layer.thicknessIn);

    if (cavW > 16) {
      horizDim(page, cavX, cavX+cavW, cavY+cavH, cavY+cavH+DIM_IN, cav.widthIn, font, 6);
    }
    const rightOfCav = cavX + cavW + DIM_IN;
    if (cavH > 10 && rightOfCav + 24 <= cx + cw - 2) {
      vertDim(page, cavY, cavY+cavH, cavX+cavW, rightOfCav, cav.depthIn, font, 6);
    }
  }

  horizDim(page, sx, sx+sW, sy, sy - DIM_OUT + 4, block.widthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx+sW, sx+sW+DIM_OUT-4, layer.thicknessIn, font, 7.5);
}

// ─── Shape drawing helpers ────────────────────────────────────────────────────

type Pt = { x: number; y: number };

function roundedRectPts(x:number, y:number, w:number, h:number, r:number, segs:number): Pt[] {
  const pts: Pt[] = [];
  const corners: [number,number,number][] = [
    [x+r,   y+r,   Math.PI      ],
    [x+w-r, y+r,   Math.PI*1.5  ],
    [x+w-r, y+h-r, 0            ],
    [x+r,   y+h-r, Math.PI*0.5  ],
  ];
  for (const [cx,cy,startAng] of corners) {
    for (let s = 0; s <= segs; s++) {
      const ang = startAng + (s/segs) * (Math.PI/2);
      pts.push({ x: cx + r*Math.cos(ang), y: cy + r*Math.sin(ang) });
    }
  }
  return pts;
}

function drawPolyLine(page:PDFPage, pts:Pt[], close:boolean, color:ReturnType<typeof rgb>, lw:number, dashed:boolean=false) {
  if (pts.length < 2) return;
  const all = close ? [...pts, pts[0]] : pts;
  const da  = dashed ? [3,2] as number[] : undefined;
  for (let i = 0; i < all.length-1; i++) {
    page.drawLine({ start:all[i], end:all[i+1], thickness:lw, color, ...(da ? {dashArray:da} : {}) });
  }
}

function fillPolyWithScanlines(page:PDFPage, pts:Pt[], color:ReturnType<typeof rgb>) {
  if (pts.length < 3) return;
  const ys   = pts.map(p=>p.y);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const steps = Math.ceil(yMax - yMin) + 2;
  const n = pts.length;
  for (let s = 0; s <= steps; s++) {
    const scanY = yMin + (s/steps)*(yMax-yMin);
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a=pts[i], b=pts[(i+1)%n];
      if ((a.y<=scanY&&b.y>scanY)||(b.y<=scanY&&a.y>scanY)) {
        xs.push(a.x + (scanY-a.y)/(b.y-a.y)*(b.x-a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a,b)=>a-b);
    const lw = xs[xs.length-1]-xs[0];
    if (lw <= 0) continue;
    page.drawLine({ start:{x:xs[0],y:scanY}, end:{x:xs[xs.length-1],y:scanY}, thickness:(yMax-yMin)/steps+1.5, color });
  }
}

function drawRoundedRectOutline(page:PDFPage, x:number, y:number, w:number, h:number, r:number, color:ReturnType<typeof rgb>, lw:number, dashed:boolean=false) {
  r = Math.max(0, Math.min(r, w/2, h/2));
  if (r <= 0) {
    page.drawRectangle({ x, y, width:w, height:h, borderColor:color, borderWidth:lw, ...(dashed?{borderDashArray:[3,2]}:{}) });
    return;
  }
  drawPolyLine(page, roundedRectPts(x,y,w,h,r,8), true, color, lw, dashed);
}

function drawBlockOutline(page:PDFPage, x:number, y:number, w:number, h:number, block:Block3D, layer:Layer3D, isPlan:boolean) {
  if (isPlan && layer.roundCorners && layer.roundRadiusIn && layer.roundRadiusIn > 0) {
    const rPx = Math.min(layer.roundRadiusIn*(w/block.lengthIn), w/2-0.5, h/2-0.5);
    fillPolyWithScanlines(page, roundedRectPts(x,y,w,h,rPx,12), C.foam);
    drawRoundedRectOutline(page, x, y, w, h, rPx, C.black, 1.5);
  } else if (
    isPlan &&
    !layer.roundCorners &&
    (layer.cropCorners || block.cornerStyle === "chamfer")
  ) {
    const chamferIn = (block.chamferIn ?? 1);
    if (Number.isFinite(chamferIn) && chamferIn > 0) {
      const cX = chamferIn * (w / block.lengthIn);
      const cY = chamferIn * (h / block.widthIn);
      const pts: Pt[] = [{x:x+cX,y},{x:x+w,y},{x:x+w,y:y+h-cY},{x:x+w-cX,y:y+h},{x,y:y+h},{x,y:y+cY}];
      fillPolyWithScanlines(page, pts, C.foam);
      drawPolyLine(page, pts, true, C.black, 1.5);
    } else {
      page.drawRectangle({ x, y, width:w, height:h, color:C.foam, borderColor:C.black, borderWidth:1.5 });
    }
  } else {
    page.drawRectangle({ x, y, width:w, height:h, color:C.foam, borderColor:C.black, borderWidth:1.5 });
  }
}

// ─── Cavity renderers ─────────────────────────────────────────────────────────

function drawCavityTopView(page:PDFPage, cav:Cavity3D, sx:number, sy:number, sW:number, sH:number, bL:number, bW:number) {
  const scX = sW/bL, scY = sH/bW;

  if (cav.shape === "circle") {
    const diamIn = cav.diameterIn || Math.min(cav.lengthIn, cav.widthIn);
    const r  = (diamIn / 2) * Math.min(scX, scY);

    const cavLeftIn = cav.x * bL;
    const cavTopIn  = cav.y * bW;

    const cx = sx + (cavLeftIn + diamIn / 2) * scX;
    // cav.y is 0=top of block → PDF y=sy+sH; increasing y goes downward
    const cy = sy + sH - (cavTopIn + diamIn / 2) * scY;
    page.drawCircle({ x:cx, y:cy, size:r, borderColor:C.cavityLine, borderWidth:0.9, borderDashArray:[3,2] });

  } else if (cav.shape === "roundedRect") {
    const cavLeftIn = cav.x * bL;
    const cavTopIn  = cav.y * bW;

    const cx  = sx + cavLeftIn * scX;
    // cavY computed from top-inches + height-inches (PDF y-up)
    const cy  = sy + sH - (cavTopIn + cav.widthIn) * scY;
    const cw  = cav.lengthIn*scX;
    const ch  = cav.widthIn*scY;
    const rPx = Math.min((cav.cornerRadiusIn||0)*Math.min(scX,scY), cw/2-0.5, ch/2-0.5);
    drawRoundedRectOutline(page, cx, cy, cw, ch, rPx, C.cavityLine, 0.9, true);

  } else if (cav.shape === "poly" && Array.isArray(cav.points) && cav.points.length >= 3) {
    // points are normalised 0-1 over the block face (x=left→right, y=top→bottom)
    const pts = cav.points.map(p => ({
      x: sx + p.x * sW,
      y: sy + sH - p.y * sH,   // flip y: 0=top→PDF top of block
    }));
    drawPolyLine(page, pts, true, C.cavityLine, 0.9, true);
    if (cav.nestedCavities) {
      for (const n of cav.nestedCavities) {
        if (!n.points||n.points.length<3) continue;
        drawPolyLine(page, n.points.map(p=>({x:sx+p.x*sW, y:sy+sH-p.y*sH})), true, C.cavityLine, 0.7, true);
      }
    }

  } else {
    // Plain rect
    const cavLeftIn = cav.x * bL;
    const cavTopIn  = cav.y * bW;

    const cx = sx + cavLeftIn * scX;
    const cy = sy + sH - (cavTopIn + cav.widthIn) * scY;
    page.drawRectangle({ x:cx, y:cy, width:cav.lengthIn*scX, height:cav.widthIn*scY,
      borderColor:C.cavityLine, borderWidth:0.9, borderDashArray:[3,2] });
  }
}

function drawCavityFrontView(page:PDFPage, cav:Cavity3D, sx:number, sy:number, sW:number, sH:number, bL:number, thk:number) {
  const scX = sW/bL, scZ = sH/thk;

  let cavX: number, cavW: number;
  if (cav.shape==="poly" && Array.isArray(cav.points) && cav.points.length>=3) {
    const xs = cav.points.map(p=>p.x);
    cavX = sx + Math.min(...xs)*sW;
    cavW = (Math.max(...xs)-Math.min(...xs))*sW;
  } else if (cav.shape==="circle") {
    const r = (cav.lengthIn/2)*scX;
    cavX = sx + (cav.x + cav.lengthIn/2)*scX*bL - r;
    cavW = r*2;
  } else {
    cavX = sx + cav.x*scX*bL;
    cavW = cav.lengthIn*scX;
  }

  const cavH = Math.min(cav.depthIn, thk)*scZ;
  // Cavity hangs from the top of the layer (top in PDF = sy+sH)
  const cavY = sy + sH - cavH;

  page.drawRectangle({ x:cavX, y:cavY, width:Math.max(cavW,1), height:Math.max(cavH,1),
    borderColor:C.cavityLine, borderWidth:0.9, borderDashArray:[3,2] });
  return { cavX, cavY, cavW, cavH };
}

function drawCavityRightView(page:PDFPage, cav:Cavity3D, sx:number, sy:number, sW:number, sH:number, bW:number, thk:number) {
  const scY = sW/bW, scZ = sH/thk;

  let cavX: number, cavW: number;
  if (cav.shape==="poly" && Array.isArray(cav.points) && cav.points.length>=3) {
    const ys = cav.points.map(p=>p.y);
    cavX = sx + Math.min(...ys)*sW;
    cavW = (Math.max(...ys)-Math.min(...ys))*sW;
  } else {
    cavX = sx + cav.y*scY*bW;
    cavW = cav.widthIn*scY;
  }

  const cavH = Math.min(cav.depthIn, thk)*scZ;
  const cavY = sy + sH - cavH;

  page.drawRectangle({ x:cavX, y:cavY, width:Math.max(cavW,1), height:Math.max(cavH,1),
    borderColor:C.cavityLine, borderWidth:0.9, borderDashArray:[3,2] });
  return { cavX, cavY, cavW, cavH };
}

// ─── Notes & Material Callout Panel ──────────────────────────────────────────

function notesPanel(
  page:PDFPage, x:number, y:number, w:number, h:number,
  input:Drawing3DInput, layer:Layer3D, layerIdx:number, totalLayers:number,
  font:any, fontBold:any,
) {
  const LABEL_H = 16, PAD = 10;

  // Header bar
  page.drawRectangle({ x, y:y+h-LABEL_H, width:w, height:LABEL_H, color:C.headerBg, borderColor:C.black, borderWidth:0.5 });
  const lbl = "NOTES & MATERIAL CALLOUT";
  page.drawText(lbl, { x:x+(w-lbl.length*5.4)/2, y:y+h-LABEL_H+4, size:8, font:fontBold, color:C.black });

  const midX  = x + w*0.50;
  const colPad = PAD + 2;

  // Vertical divider
  page.drawLine({ start:{x:midX,y}, end:{x:midX,y:y+h-LABEL_H}, thickness:0.5, color:C.black });

  // ── Left: general notes ───────────────────────────────────────────────────
  let ly = y + h - LABEL_H - colPad - 6;
  const defaultNotes = [
    "ALL DIMENSIONS IN INCHES UNLESS OTHERWISE NOTED.",
    `TOLERANCES: \xB11/8" OUTSIDE DIMS; \xB11/16" CAVITIES.`,
    "DO NOT SCALE DRAWING.",
    "FOAM ORIENTATION: RISE DIRECTION AS SHOWN.",
    "DASHED LINES INDICATE CAVITIES / HIDDEN EDGES.",
  ];
  const notes = (input.notes && input.notes.length>0) ? input.notes : defaultNotes;
  page.drawText("GENERAL NOTES:", { x:x+colPad, y:ly, size:7, font:fontBold, color:C.black });
  ly -= 11;
  for (let i = 0; i < notes.length; i++) {
    page.drawText(`${i+1}.  ${notes[i]}`, { x:x+colPad+4, y:ly, size:6.5, font, color:C.black });
    ly -= 9.5;
  }

  // ── Right: layer details ──────────────────────────────────────────────────
  let ry = y + h - LABEL_H - colPad - 6;
  const layerName = layer.label || `Layer ${layerIdx+1}`;

  const modifiers: string[] = [];
  if (layer.roundCorners && layer.roundRadiusIn) modifiers.push(`Rounded r=${layer.roundRadiusIn}"`);
  if (layer.cropCorners) modifiers.push("Chamfered corners");
  if (input.block.cornerStyle==="chamfer" && input.block.chamferIn) modifiers.push(`Block chamfer ${input.block.chamferIn}"`);

  // Compact block dims on one line: L × W × H
  const blockDimsVal = `${input.block.lengthIn.toFixed(3)}" \xD7 ${input.block.widthIn.toFixed(3)}" \xD7 ${input.block.heightIn.toFixed(3)}"`;

  page.drawText("LAYER DETAILS:", { x:midX+colPad, y:ry, size:7, font:fontBold, color:C.black });
  ry -= 11;

  const details: Array<[string, string]> = [
    ["Layer",       `${layerName}  (${layerIdx+1} of ${totalLayers})`],
    ["Thickness",   `${layer.thicknessIn.toFixed(3)}"`],
    ["Material",    layer.materialName || "\u2014"],
    ["Block Dims",  blockDimsVal],
    ["Cavities",    layer.cavities.length > 0 ? `${layer.cavities.length}` : "None"],
    ...(modifiers.length>0 ? [["Modifiers", modifiers.join("; ")] as [string,string]] : []),
  ];

  const labelColW = 56;
  for (const [label, val] of details) {
    page.drawText(`${label}:`, { x:midX+colPad, y:ry, size:6.5, font:fontBold, color:C.black });
    page.drawText(val,         { x:midX+colPad+labelColW, y:ry, size:6.5, font, color:C.black });
    ry -= 9.5;
  }

  // ── Cavity schedule ───────────────────────────────────────────────────────
  if (layer.cavities.length > 0) {
    ry -= 3;
    page.drawText("CAVITY SCHEDULE:", { x:midX+colPad, y:ry, size:7, font:fontBold, color:C.black });
    ry -= 10;

    // Columns — tightened to fit more info
    const cols = [
      { label:"#",     ox:0   , w:12  },
      { label:"SHAPE", ox:13  , w:44  },
      { label:`L"`,    ox:58  , w:32  },
      { label:`W"`,    ox:91  , w:32  },
      { label:`D"`,    ox:124 , w:32  },
      { label:"R\"",   ox:157 , w:32  },
    ];
    for (const col of cols) {
      page.drawText(col.label, { x:midX+colPad+col.ox, y:ry, size:6, font:fontBold, color:C.black });
    }
    ry -= 1;
    page.drawLine({ start:{x:midX+colPad,y:ry}, end:{x:midX+colPad+190,y:ry}, thickness:0.4, color:C.dimLine });
    ry -= 8;

    for (let ci = 0; ci < layer.cavities.length; ci++) {
      const cav = layer.cavities[ci];
      const shapeLabel =
        cav.shape==="roundedRect" ? "RND RECT"
        : cav.shape==="poly"      ? "POLYGON"
        : cav.shape.toUpperCase();
      const rLabel = cav.shape==="roundedRect" && cav.cornerRadiusIn
        ? cav.cornerRadiusIn.toFixed(3) : "\u2014";

      const row = [String(ci+1), shapeLabel, cav.lengthIn.toFixed(3), cav.widthIn.toFixed(3), cav.depthIn.toFixed(3), rLabel];
      for (let ri = 0; ri < cols.length; ri++) {
        page.drawText(row[ri], { x:midX+colPad+cols[ri].ox, y:ry, size:6, font, color:C.black });
      }
      ry -= 8.5;
      if (ry < y+4) break;
    }
  }
}

// ─── Title block ──────────────────────────────────────────────────────────────

function titleBlock(
  page:PDFPage, x:number, y:number, w:number, h:number,
  font:any, fontBold:any,
  quoteNo:string, customerName:string|undefined,
  revision:string, date:string, title:string, sheet:string,
) {
  page.drawRectangle({ x, y, width:w, height:h, color:C.white, borderColor:C.black, borderWidth:1.5 });

  const leftW = w*0.60;
  page.drawRectangle({ x, y, width:leftW, height:h, color:C.titleBg });
  page.drawText(title, { x:x+12, y:y+h-20, size:12, font:fontBold, color:C.titleFg });
  page.drawLine({ start:{x,y:y+h-26}, end:{x:x+leftW,y:y+h-26}, thickness:0.5, color:C.gridLight });
  page.drawText(`Quote: ${quoteNo}`, { x:x+12, y:y+h-40, size:9, font, color:C.titleFg });
  if (customerName) {
    page.drawText(`Customer: ${customerName}`, { x:x+12, y:y+h-52, size:9, font, color:C.titleFg });
  }
  page.drawText("FOR MANUFACTURING USE ONLY \u2013 INTERNAL DOCUMENT",
    { x:x+12, y:y+8, size:7, font, color:rgb(0.55,0.55,0.55) });

  const boxW = (w-leftW)/2, boxH = h/2;
  for (const box of [
    { label:"REVISION", value:revision, bx:x+leftW,      by:y+boxH },
    { label:"DATE",     value:date,     bx:x+leftW+boxW, by:y+boxH },
    { label:"SCALE",    value:"NTS",    bx:x+leftW,      by:y      },
    { label:"SHEET",    value:sheet,    bx:x+leftW+boxW, by:y      },
  ]) {
    page.drawRectangle({ x:box.bx, y:box.by, width:boxW, height:boxH, borderColor:C.black, borderWidth:0.5 });
    page.drawRectangle({ x:box.bx, y:box.by+boxH-13, width:boxW, height:13, color:C.headerBg });
    page.drawText(box.label, { x:box.bx+4, y:box.by+boxH-10, size:6,  font:fontBold, color:C.black });
    page.drawText(box.value, { x:box.bx+4, y:box.by+6,       size:10, font:fontBold, color:C.black });
  }
}

// ─── Dimension helpers ────────────────────────────────────────────────────────
// horizDim: dim line AT dimY; extension lines rise from shapeEdgeY.
// "shapeEdgeY" is the Y of the shape edge the extensions start from.

function horizDim(page:PDFPage, x1:number, x2:number, shapeEdgeY:number, dimY:number, val:number, font:any, textSize:number=7.5) {
  if (Math.abs(x2-x1) < 6) return;
  const col=C.dimLine, asz=3.5;
  // Extension lines from shape edge to dim line
  page.drawLine({ start:{x:x1,y:shapeEdgeY+2}, end:{x:x1,y:dimY-3}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:shapeEdgeY+2}, end:{x:x2,y:dimY-3}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x2,y:dimY}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x1+asz,y:dimY+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x1+asz,y:dimY-asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:dimY}, end:{x:x2-asz,y:dimY+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:dimY}, end:{x:x2-asz,y:dimY-asz}, thickness:0.5, color:col });
  const txt=`${val.toFixed(2)}"`, tw=txt.length*(textSize*0.60), mx=(x1+x2)/2;
  page.drawRectangle({ x:mx-tw/2-2, y:dimY-5, width:tw+4, height:10, color:C.white });
  page.drawText(txt, { x:mx-tw/2, y:dimY-3, size:textSize, font, color:C.black });
}

// vertDim: dim line AT dimX; extension lines go from shapeEdgeX to dimX.
// y1=bottom, y2=top of dimensioned span.

function vertDim(page:PDFPage, y1:number, y2:number, shapeEdgeX:number, dimX:number, val:number, font:any, textSize:number=7.5) {
  if (Math.abs(y2-y1) < 6) return;
  const col=C.dimLine, asz=3.5;
  const dir = dimX > shapeEdgeX ? 1 : -1;   // +1 = dim is to the right, -1 = to the left
  page.drawLine({ start:{x:shapeEdgeX+dir*2,y:y1}, end:{x:dimX-dir*3,y:y1}, thickness:0.5, color:col });
  page.drawLine({ start:{x:shapeEdgeX+dir*2,y:y2}, end:{x:dimX-dir*3,y:y2}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX,y:y2}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX-asz,y:y1+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX+asz,y:y1+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y2}, end:{x:dimX-asz,y:y2-asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y2}, end:{x:dimX+asz,y:y2-asz}, thickness:0.5, color:col });
  const txt=`${val.toFixed(2)}"`, my=(y1+y2)/2, tw=txt.length*(textSize*0.60);
  page.drawRectangle({ x:dimX-tw/2-2, y:my-5, width:tw+4, height:10, color:C.white });
  page.drawText(txt, { x:dimX-tw/2, y:my-3, size:textSize, font, color:C.black });
}
