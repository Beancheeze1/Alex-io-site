// lib/pdf/threeview.ts
//
// Generates a CAD-style technical drawing (Front, Top, Isometric) as PDF.
// Layout follows standard drafting conventions:
//   Top-left:     FRONT VIEW  (looking along +Y; shows X × Z)
//   Top-right:    TOP VIEW    (looking down -Z; shows X × Y, cavities)
//   Bottom-right: ISOMETRIC   (axonometric 3D projection)
//   Bottom-left:  NOTES / material callout
//   Bottom strip: Full engineering title block

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
  border:     rgb(0,    0,    0),
  dimLine:    rgb(0.15, 0.15, 0.15),
  foam:       rgb(0.93, 0.93, 0.93),
  foamAlt:    rgb(0.97, 0.97, 0.97),
  cavityLine: rgb(0.75, 0,    0),
  titleBg:    rgb(0.10, 0.10, 0.10),
  titleFg:    rgb(1,    1,    1),
  headerBg:   rgb(0.84, 0.84, 0.84),
  crosshair:  rgb(0.65, 0.65, 0.65),
  isoFace1:   rgb(0.93, 0.93, 0.93),
  isoFace2:   rgb(0.80, 0.80, 0.80),
  isoFace3:   rgb(0.74, 0.74, 0.74),
  gridLight:  rgb(0.75, 0.75, 0.75),
};

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generate3ViewPDF(input: Drawing3DInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const W = 792;
  const H = 612;
  const page = pdfDoc.addPage([W, H]);

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const MARGIN   = 24;
  const TITLE_H  = 90;
  const VIEW_PAD = 14;
  const LABEL_H  = 18;

  const frameX = MARGIN;
  const frameY = MARGIN + TITLE_H;
  const frameW = W - 2 * MARGIN;
  const frameH = H - 2 * MARGIN - TITLE_H;
  const colW   = frameW / 2;
  const rowH   = frameH / 2;

  const cells = {
    front: { x: frameX,        y: frameY + rowH, w: colW, h: rowH },
    top:   { x: frameX + colW, y: frameY + rowH, w: colW, h: rowH },
    notes: { x: frameX,        y: frameY,         w: colW, h: rowH },
    iso:   { x: frameX + colW, y: frameY,         w: colW, h: rowH },
  };

  // Outer border
  page.drawRectangle({ x: MARGIN, y: MARGIN, width: W - 2*MARGIN, height: H - 2*MARGIN, borderColor: C.black, borderWidth: 2 });

  // Cell dividers
  page.drawLine({ start: { x: frameX + colW, y: frameY }, end: { x: frameX + colW, y: frameY + frameH }, thickness: 0.75, color: C.black });
  page.drawLine({ start: { x: frameX, y: frameY + rowH }, end: { x: frameX + frameW, y: frameY + rowH }, thickness: 0.75, color: C.black });

  const { block, layers } = input;

  placeViewCell(page, cells.front, "FRONT VIEW", font, fontBold, VIEW_PAD, LABEL_H, (vx, vy, vw, vh) =>
    drawFrontView(page, { x: vx, y: vy, w: vw, h: vh, block, layers, font, fontBold }));

  placeViewCell(page, cells.top, "TOP VIEW", font, fontBold, VIEW_PAD, LABEL_H, (vx, vy, vw, vh) =>
    drawTopView(page, { x: vx, y: vy, w: vw, h: vh, block, layers, font, fontBold }));

  placeViewCell(page, cells.iso, "ISOMETRIC VIEW", font, fontBold, VIEW_PAD, LABEL_H, (vx, vy, vw, vh) =>
    drawIsoView(page, { x: vx, y: vy, w: vw, h: vh, block, layers, font, fontBold }));

  placeNotesCell(page, cells.notes, input, font, fontBold, VIEW_PAD, LABEL_H);

  drawTitleBlock(page, {
    x: MARGIN, y: MARGIN, w: frameW, h: TITLE_H,
    font, fontBold,
    quoteNo: input.quoteNo,
    customerName: input.customerName,
    revision: input.revision || "AS",
    date: input.date || new Date().toISOString().split("T")[0],
    title: "FOAM INSERT \u2013 TECHNICAL DRAWING",
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ─── Cell wrapper ─────────────────────────────────────────────────────────────

function placeViewCell(
  page: PDFPage,
  cell: { x: number; y: number; w: number; h: number },
  label: string,
  font: any, fontBold: any,
  pad: number, labelH: number,
  drawFn: (vx: number, vy: number, vw: number, vh: number) => void,
) {
  const { x, y, w, h } = cell;
  // Label bar
  page.drawRectangle({ x, y: y + h - labelH, width: w, height: labelH, color: C.headerBg, borderColor: C.black, borderWidth: 0.5 });
  const tw = label.length * 5.4;
  page.drawText(label, { x: x + (w - tw) / 2, y: y + h - labelH + 5, size: 8, font: fontBold, color: C.black });
  drawFn(x + pad, y + pad, w - 2 * pad, h - labelH - 2 * pad);
}

// ─── Notes cell ───────────────────────────────────────────────────────────────

function placeNotesCell(
  page: PDFPage,
  cell: { x: number; y: number; w: number; h: number },
  input: Drawing3DInput,
  font: any, fontBold: any,
  pad: number, labelH: number,
) {
  const { x, y, w, h } = cell;
  page.drawRectangle({ x, y: y + h - labelH, width: w, height: labelH, color: C.headerBg, borderColor: C.black, borderWidth: 0.5 });
  const lbl = "NOTES & MATERIAL CALLOUT";
  page.drawText(lbl, { x: x + (w - lbl.length * 5.4) / 2, y: y + h - labelH + 5, size: 8, font: fontBold, color: C.black });

  let cy = y + h - labelH - pad - 10;

  const defaultNotes = [
    "ALL DIMENSIONS IN INCHES UNLESS OTHERWISE NOTED.",
    "TOLERANCES: \xB11/8\" OUTSIDE DIMS; \xB11/16\" CAVITIES.",
    "DO NOT SCALE DRAWING.",
    "FOAM ORIENTATION: RISE DIRECTION AS SHOWN.",
    "HIDDEN LINES SHOWN DASHED (CAVITIES).",
  ];
  const notes = (input.notes && input.notes.length > 0) ? input.notes : defaultNotes;

  page.drawText("GENERAL NOTES:", { x: x + pad, y: cy, size: 7, font: fontBold, color: C.black });
  cy -= 11;
  for (let i = 0; i < notes.length; i++) {
    page.drawText(`${i + 1}.  ${notes[i]}`, { x: x + pad + 4, y: cy, size: 6.5, font, color: C.black });
    cy -= 10;
  }

  cy -= 10;
  page.drawText("MATERIAL CALLOUT:", { x: x + pad, y: cy, size: 7, font: fontBold, color: C.black });
  cy -= 11;
  for (let i = 0; i < input.layers.length; i++) {
    const layer = input.layers[i];
    const txt = `LAYER ${i + 1}  (${layer.thicknessIn.toFixed(3)}")  \u2013  ${layer.materialName || "FOAM"}`;
    page.drawText(txt, { x: x + pad + 4, y: cy, size: 6.5, font, color: C.black });
    cy -= 10;
  }
}

// ─── Shared view params type ──────────────────────────────────────────────────

type VP = { x: number; y: number; w: number; h: number; block: Block3D; layers: Layer3D[]; font: any; fontBold: any };

// ─── Front View (X x Z) ───────────────────────────────────────────────────────

function drawFrontView(page: PDFPage, p: VP) {
  const { x, y, w, h, block, layers, font } = p;
  const DS = 28;
  const scale = Math.min((w - DS*2) / block.lengthIn, (h - DS*2) / block.heightIn) * 0.85;
  const dW = block.lengthIn * scale;
  const dH = block.heightIn * scale;
  const ox = x + (w - dW) / 2;
  const oy = y + (h - dH) / 2;

  crosshair(page, ox + dW/2, oy + dH/2, 12);

  let cz = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const lh = layer.thicknessIn * scale;
    const ly = oy + cz * scale;
    page.drawRectangle({ x: ox, y: ly, width: dW, height: lh, color: i % 2 === 0 ? C.foam : C.foamAlt, borderColor: C.dimLine, borderWidth: 0.75 });

    // Layer label
    const lbl = layer.label || `L${i+1}`;
    page.drawText(lbl, { x: ox - 20, y: ly + lh/2 - 3, size: 6, font, color: C.black });

    // Cavity cross-sections (dashed, depth from top)
    for (const cav of layer.cavities) {
      const cx  = ox + cav.x * block.lengthIn * scale;
      const cw  = cav.lengthIn * scale;
      const cdh = Math.min(cav.depthIn, layer.thicknessIn) * scale;
      dashedRect(page, cx, ly + lh - cdh, cw, cdh, C.cavityLine, 0.75);
    }
    cz += layer.thicknessIn;
  }

  // Outer bold border
  page.drawRectangle({ x: ox, y: oy, width: dW, height: dH, borderColor: C.black, borderWidth: 1.75 });

  horizDim(page, ox, ox + dW, oy - DS + 8, block.lengthIn, font);
  vertDim(page,  ox + dW + DS - 8, oy, oy + dH, block.heightIn, font);
}

// ─── Top View (X x Y) ─────────────────────────────────────────────────────────

function drawTopView(page: PDFPage, p: VP) {
  const { x, y, w, h, block, layers, font } = p;
  const DS = 28;
  const scale = Math.min((w - DS*2) / block.lengthIn, (h - DS*2) / block.widthIn) * 0.85;
  const dW = block.lengthIn * scale;
  const dH = block.widthIn * scale;
  const ox = x + (w - dW) / 2;
  const oy = y + (h - dH) / 2;

  crosshair(page, ox + dW/2, oy + dH/2, 12);

  page.drawRectangle({ x: ox, y: oy, width: dW, height: dH, color: C.foam, borderColor: C.black, borderWidth: 1.75 });

  for (const layer of layers) {
    for (const cav of layer.cavities) {
      if (cav.shape === "circle") {
        const diam = cav.diameterIn || Math.min(cav.lengthIn, cav.widthIn);
        const r  = (diam / 2) * scale;
        const cx = ox + (cav.x + cav.lengthIn/2) * block.lengthIn * scale;
        const cy = oy + dH - (cav.y + cav.widthIn/2) * block.widthIn * scale;
        page.drawCircle({ x: cx, y: cy, size: r, borderColor: C.cavityLine, borderWidth: 0.75, borderDashArray: [3, 2] });
      } else {
        const cx = ox + cav.x * block.lengthIn * scale;
        const cy = oy + dH - (cav.y + cav.widthIn) * block.widthIn * scale;
        dashedRect(page, cx, cy, cav.lengthIn * scale, cav.widthIn * scale, C.cavityLine, 0.75);
      }
    }
  }

  horizDim(page, ox, ox + dW, oy - DS + 8, block.lengthIn, font);
  vertDim(page,  ox - DS + 8, oy, oy + dH, block.widthIn, font);
}

// ─── Isometric View ───────────────────────────────────────────────────────────

function iso(wx: number, wy: number, wz: number, sc: number): { x: number; y: number } {
  const ang = Math.PI / 6;
  const depth = 0.5;
  return { x: wx*sc - wy*Math.cos(ang)*sc*depth, y: wz*sc - wy*Math.sin(ang)*sc*depth };
}

function drawIsoView(page: PDFPage, p: VP) {
  const { x, y, w, h, block, layers, font } = p;
  const L = block.lengthIn, W = block.widthIn, Z = block.heightIn;
  const ang = Math.PI / 6;
  const projW = L + W * Math.cos(ang) * 0.5;
  const projH = Z + W * Math.sin(ang) * 0.5;
  const margin = 22;
  const sc = Math.min((w - 2*margin) / projW, (h - 2*margin) / projH) * 0.80;

  const mid = iso(L/2, W/2, Z/2, sc);
  const ox = x + w/2 - mid.x;
  const oy = y + h/2 - mid.y;

  function pt(wx: number, wy: number, wz: number) {
    const p2 = iso(wx, wy, wz, sc);
    return { x: ox + p2.x, y: oy + p2.y };
  }

  // Draw layer faces back-to-front
  let cz = 0;
  for (let i = 0; i < layers.length; i++) {
    const lh = layers[i].thicknessIn;
    const z0 = cz, z1 = cz + lh;

    // Top face (only on topmost)
    if (i === layers.length - 1) {
      isoFill(page, [pt(0,0,z1), pt(L,0,z1), pt(L,W,z1), pt(0,W,z1)], C.isoFace1);
    }
    // Right face
    isoFill(page, [pt(L,0,z0), pt(L,W,z0), pt(L,W,z1), pt(L,0,z1)], C.isoFace2);
    // Front face
    isoFill(page, [pt(0,0,z0), pt(L,0,z0), pt(L,0,z1), pt(0,0,z1)], C.isoFace3);
    cz += lh;
  }

  // Layer separator lines
  cz = 0;
  for (let i = 0; i < layers.length - 1; i++) {
    cz += layers[i].thicknessIn;
    line(page, pt(0,0,cz), pt(L,0,cz), 0.5, C.dimLine);
    line(page, pt(L,0,cz), pt(L,W,cz), 0.5, C.dimLine);
  }

  // Bold outer edges
  const ew = 1.5;
  const c = {
    fbl: pt(0,0,0), fbr: pt(L,0,0), ftl: pt(0,0,Z), ftr: pt(L,0,Z),
    bbl: pt(0,W,0), bbr: pt(L,W,0), btl: pt(0,W,Z), btr: pt(L,W,Z),
  };
  // Bottom
  line(page, c.fbl, c.fbr, ew, C.black); line(page, c.fbr, c.bbr, ew, C.black);
  line(page, c.fbl, c.bbl, ew, C.black); line(page, c.bbl, c.bbr, ew, C.black);
  // Top
  line(page, c.ftl, c.ftr, ew, C.black); line(page, c.ftr, c.btr, ew, C.black);
  line(page, c.ftl, c.btl, ew, C.black); line(page, c.btl, c.btr, ew, C.black);
  // Verticals
  line(page, c.fbl, c.ftl, ew, C.black); line(page, c.fbr, c.ftr, ew, C.black);
  line(page, c.bbr, c.btr, ew, C.black);
  // Hidden back-left vertical dashed
  dashedLine(page, c.bbl, c.btl, 0.5, C.dimLine, [3,3]);

  // Cavities on top face (topmost layer)
  const topLayer = layers[layers.length - 1];
  if (topLayer) {
    for (const cav of topLayer.cavities) {
      const cx0 = cav.x * L, cy0 = cav.y * W;
      const cx1 = cx0 + cav.lengthIn, cy1 = cy0 + cav.widthIn;
      const corners = [pt(cx0,cy0,Z), pt(cx1,cy0,Z), pt(cx1,cy1,Z), pt(cx0,cy1,Z)];
      for (let i = 0; i < corners.length; i++) {
        dashedLine(page, corners[i], corners[(i+1) % corners.length], 0.75, C.cavityLine, [3,2]);
      }
    }
  }

  // Dimension callouts
  const off = 10;
  const Lmid = { x: (pt(0,0,0).x + pt(L,0,0).x)/2, y: (pt(0,0,0).y + pt(L,0,0).y)/2 };
  page.drawText(`L: ${L.toFixed(2)}"`, { x: Lmid.x - 12, y: Lmid.y - off, size: 7, font, color: C.dimLine });

  const Wmid = { x: (pt(L,0,0).x + pt(L,W,0).x)/2, y: (pt(L,0,0).y + pt(L,W,0).y)/2 };
  page.drawText(`W: ${W.toFixed(2)}"`, { x: Wmid.x + 4, y: Wmid.y - 4, size: 7, font, color: C.dimLine });

  const Hmid = { x: (pt(L,0,0).x + pt(L,0,Z).x)/2, y: (pt(L,0,0).y + pt(L,0,Z).y)/2 };
  page.drawText(`H: ${Z.toFixed(2)}"`, { x: Hmid.x + 5, y: Hmid.y, size: 7, font, color: C.dimLine });
}

// ─── Title block ──────────────────────────────────────────────────────────────

type TitleP = { x:number; y:number; w:number; h:number; font:any; fontBold:any; quoteNo:string; customerName?:string; revision:string; date:string; title:string };

function drawTitleBlock(page: PDFPage, p: TitleP) {
  const { x, y, w, h, font, fontBold } = p;

  page.drawRectangle({ x, y, width: w, height: h, color: C.white, borderColor: C.black, borderWidth: 1.5 });

  const leftW = w * 0.60;
  page.drawRectangle({ x, y, width: leftW, height: h, color: C.titleBg });

  page.drawText(p.title, { x: x + 12, y: y + h - 22, size: 13, font: fontBold, color: C.titleFg });
  page.drawLine({ start: { x, y: y + h - 28 }, end: { x: x + leftW, y: y + h - 28 }, thickness: 0.5, color: C.gridLight });
  page.drawText(`Quote: ${p.quoteNo}`, { x: x + 12, y: y + h - 44, size: 9, font, color: C.titleFg });
  if (p.customerName) {
    page.drawText(`Customer: ${p.customerName}`, { x: x + 12, y: y + h - 57, size: 9, font, color: C.titleFg });
  }
  page.drawText("FOR MANUFACTURING USE ONLY \u2013 INTERNAL DOCUMENT", { x: x + 12, y: y + 10, size: 7, font, color: rgb(0.55,0.55,0.55) });

  const boxW = (w - leftW) / 2;
  const boxH = h / 2;
  const boxes = [
    { label: "REVISION", value: p.revision,  bx: x + leftW,        by: y + boxH },
    { label: "DATE",     value: p.date,       bx: x + leftW + boxW, by: y + boxH },
    { label: "SCALE",    value: "NTS",        bx: x + leftW,        by: y },
    { label: "SHEET",    value: "1 OF 1",     bx: x + leftW + boxW, by: y },
  ];
  for (const box of boxes) {
    page.drawRectangle({ x: box.bx, y: box.by, width: boxW, height: boxH, borderColor: C.black, borderWidth: 0.5 });
    page.drawRectangle({ x: box.bx, y: box.by + boxH - 14, width: boxW, height: 14, color: C.headerBg });
    page.drawText(box.label, { x: box.bx + 4, y: box.by + boxH - 11, size: 6.5, font: fontBold, color: C.black });
    page.drawText(box.value, { x: box.bx + 4, y: box.by + 8, size: 10, font: fontBold, color: C.black });
  }
}

// ─── Drawing primitives ───────────────────────────────────────────────────────

type Pt = { x: number; y: number };
type Col = ReturnType<typeof rgb>;

function line(page: PDFPage, a: Pt, b: Pt, thickness: number, color: Col) {
  page.drawLine({ start: a, end: b, thickness, color });
}

function dashedLine(page: PDFPage, a: Pt, b: Pt, thickness: number, color: Col, dashArray: number[]) {
  page.drawLine({ start: a, end: b, thickness, color, dashArray });
}

function dashedRect(page: PDFPage, x: number, y: number, w: number, h: number, color: Col, thickness: number) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: thickness, borderDashArray: [3, 2] });
}

function crosshair(page: PDFPage, cx: number, cy: number, sz: number) {
  page.drawLine({ start: { x: cx-sz, y: cy }, end: { x: cx+sz, y: cy }, thickness: 0.35, color: C.crosshair, dashArray: [2,2] });
  page.drawLine({ start: { x: cx, y: cy-sz }, end: { x: cx, y: cy+sz }, thickness: 0.35, color: C.crosshair, dashArray: [2,2] });
  page.drawCircle({ x: cx, y: cy, size: 2, borderColor: C.crosshair, borderWidth: 0.35 });
}

function isoFill(page: PDFPage, pts: Pt[], color: Col) {
  if (pts.length < 3) return;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i+1) % pts.length];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = mx - cx, dy = my - cy;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    page.drawLine({ start: { x: cx, y: cy }, end: { x: mx, y: my }, thickness: len * 2.2, color });
  }
}

function horizDim(page: PDFPage, x1: number, x2: number, y: number, val: number, font: any) {
  const asz = 4, col = C.dimLine;
  page.drawLine({ start: { x: x1, y: y-6 }, end: { x: x1, y: y+6 }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x2, y: y-6 }, end: { x: x2, y: y+6 }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x1, y }, end: { x: x1+asz, y: y+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x1, y }, end: { x: x1+asz, y: y-asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x2, y }, end: { x: x2-asz, y: y+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x2, y }, end: { x: x2-asz, y: y-asz }, thickness: 0.5, color: col });
  const txt = `${val.toFixed(2)}"`;
  const tw = txt.length * 4.5;
  const mx = (x1+x2)/2;
  page.drawRectangle({ x: mx-tw/2-1, y: y+2, width: tw+2, height: 9, color: C.white });
  page.drawText(txt, { x: mx-tw/2, y: y+4, size: 7.5, font, color: C.black });
}

function vertDim(page: PDFPage, x: number, y1: number, y2: number, val: number, font: any) {
  const asz = 4, col = C.dimLine;
  page.drawLine({ start: { x: x-6, y: y1 }, end: { x: x+6, y: y1 }, thickness: 0.5, color: col });
  page.drawLine({ start: { x: x-6, y: y2 }, end: { x: x+6, y: y2 }, thickness: 0.5, color: col });
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.5, color: col });
  page.drawLine({ start: { x, y: y1 }, end: { x: x-asz, y: y1+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x, y: y1 }, end: { x: x+asz, y: y1+asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x, y: y2 }, end: { x: x-asz, y: y2-asz }, thickness: 0.5, color: col });
  page.drawLine({ start: { x, y: y2 }, end: { x: x+asz, y: y2-asz }, thickness: 0.5, color: col });
  const txt = `${val.toFixed(2)}"`;
  const my = (y1+y2)/2;
  const tw = txt.length * 4.5;
  page.drawRectangle({ x: x+2, y: my-5, width: tw+2, height: 9, color: C.white });
  page.drawText(txt, { x: x+4, y: my-3, size: 7.5, font, color: C.black });
}