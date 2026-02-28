// lib/pdf/threeview.ts
//
// CAD-style orthographic drawing: ONE PAGE PER LAYER.
//
// Each page layout (landscape 11×8.5):
//   ┌─────────────────────────────────────────────────────────┐
//   │  COL HEADERS: FRONT VIEW │ TOP VIEW │ RIGHT VIEW        │
//   ├──────────────┬───────────┴──────────┴───────────────────┤  ← top 2/3
//   │              │                                           │
//   │  FRONT VIEW  │         TOP VIEW        │   RIGHT VIEW   │
//   │  (L × H)     │         (L × W)         │   (W × H)     │
//   │              │                         │                │
//   ├──────────────┴─────────────────────────┴────────────────┤  ← bottom 1/3
//   │  NOTES & MATERIAL CALLOUT                               │
//   ├─────────────────────────────────────────────────────────┤
//   │  TITLE BLOCK                                            │
//   └─────────────────────────────────────────────────────────┘

import { PDFDocument, PDFPage, rgb, StandardFonts } from "pdf-lib";

// ─── Public types ─────────────────────────────────────────────────────────────

export type Block3D = {
  lengthIn: number;   // X
  widthIn:  number;   // Y
  heightIn: number;   // Z (total stack)
};

export type Cavity3D = {
  id:          string;
  shape:       "rect" | "circle" | "poly";
  x:           number;   // 0-1 normalised from left
  y:           number;   // 0-1 normalised from top
  lengthIn:    number;
  widthIn:     number;
  depthIn:     number;
  diameterIn?: number;
  points?:     Array<{ x: number; y: number }>;
  label?:      string;
};

export type Layer3D = {
  id:            string;
  label?:        string;
  thicknessIn:   number;
  materialName?: string;
  cavities:      Cavity3D[];
};

export type Drawing3DInput = {
  quoteNo:       string;
  customerName?: string;
  block:         Block3D;
  layers:        Layer3D[];
  revision?:     string;
  date?:         string;
  notes?:        string[];
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

  const PW = 792, PH = 612; // 11 × 8.5 landscape

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const numPages = layers.length;

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const page  = pdfDoc.addPage([PW, PH]);

    const MARGIN   = 24;
    const TITLE_H  = 80;
    const NOTES_H  = 130;  // notes panel height
    const HDR_H    = 18;   // column header strip height

    // Full drawing frame (above title block)
    const frameX = MARGIN;
    const frameY = MARGIN + TITLE_H;
    const frameW = PW - 2 * MARGIN;
    const frameH = PH - 2 * MARGIN - TITLE_H;

    // Three-view area sits above the notes panel
    const viewsH  = frameH - NOTES_H;     // height of the 3-view zone
    const viewsY  = frameY + NOTES_H;     // bottom-left Y of views zone
    const colW    = frameW / 3;
    const drawH   = viewsH - HDR_H;       // height inside a view cell (below header)

    // Outer border
    page.drawRectangle({
      x: MARGIN, y: MARGIN, width: PW - 2*MARGIN, height: PH - 2*MARGIN,
      borderColor: C.black, borderWidth: 2,
    });

    // ── Column header bar ────────────────────────────────────────────────────
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
      const tw  = lbl.length * 5.1;
      page.drawText(lbl, {
        x: frameX + ci*colW + (colW - tw)/2, y: hdrY + 5,
        size: 7.5, font: fontBold, color: C.black,
      });
    }

    // ── Vertical column dividers (full height, views + header) ───────────────
    page.drawLine({ start:{x:frameX+colW,   y:frameY+NOTES_H}, end:{x:frameX+colW,   y:hdrY+HDR_H}, thickness:0.75, color:C.black });
    page.drawLine({ start:{x:frameX+2*colW, y:frameY+NOTES_H}, end:{x:frameX+2*colW, y:hdrY+HDR_H}, thickness:0.75, color:C.black });

    // ── Horizontal divider between views and notes ───────────────────────────
    page.drawLine({ start:{x:frameX, y:frameY+NOTES_H}, end:{x:frameX+frameW, y:frameY+NOTES_H}, thickness:0.75, color:C.black });

    // ── Three views ──────────────────────────────────────────────────────────
    frontView (page, frameX,          viewsY, colW, drawH, block, layer, font);
    topView   (page, frameX + colW,   viewsY, colW, drawH, block, layer, font);
    rightView (page, frameX + 2*colW, viewsY, colW, drawH, block, layer, font);

    // ── Notes & material callout panel ───────────────────────────────────────
    notesPanel(page, frameX, frameY, frameW, NOTES_H, input, layer, li, layers.length, font, fontBold);

    // ── Title block ──────────────────────────────────────────────────────────
    titleBlock(page, frameX, MARGIN, frameW, TITLE_H, font, fontBold,
      input.quoteNo, input.customerName,
      input.revision || "AS",
      input.date || new Date().toISOString().split("T")[0],
      "FOAM INSERT \u2013 TECHNICAL DRAWING",
      `${li + 1} OF ${numPages}`);
  }

  return Buffer.from(await pdfDoc.save());
}

// ─── Notes & Material Callout Panel ──────────────────────────────────────────

function notesPanel(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  input: Drawing3DInput,
  layer: Layer3D,
  layerIdx: number,
  totalLayers: number,
  font: any, fontBold: any,
) {
  const LABEL_H = 18;
  const PAD     = 10;

  // Panel label bar
  page.drawRectangle({
    x, y: y + h - LABEL_H, width: w, height: LABEL_H,
    color: C.headerBg, borderColor: C.black, borderWidth: 0.5,
  });
  const lbl = "NOTES & MATERIAL CALLOUT";
  page.drawText(lbl, {
    x: x + (w - lbl.length * 5.4) / 2, y: y + h - LABEL_H + 5,
    size: 8, font: fontBold, color: C.black,
  });

  // Two-column layout inside panel: left = notes, right = material/layer info
  const midX   = x + w * 0.52;
  const colPad = PAD + 4;

  // Vertical divider
  page.drawLine({
    start: {x: midX, y: y}, end: {x: midX, y: y + h - LABEL_H},
    thickness: 0.5, color: C.black,
  });

  // ── Left column: general notes ────────────────────────────────────────────
  let ly = y + h - LABEL_H - colPad - 8;

  const defaultNotes = [
    "ALL DIMENSIONS IN INCHES UNLESS OTHERWISE NOTED.",
    `TOLERANCES: \xB11/8" OUTSIDE DIMS; \xB11/16" CAVITIES.`,
    "DO NOT SCALE DRAWING.",
    "FOAM ORIENTATION: RISE DIRECTION AS SHOWN.",
    "HIDDEN LINES (DASHED) INDICATE CAVITIES.",
  ];
  const notes = (input.notes && input.notes.length > 0) ? input.notes : defaultNotes;

  page.drawText("GENERAL NOTES:", { x: x + colPad, y: ly, size: 7, font: fontBold, color: C.black });
  ly -= 12;
  for (let i = 0; i < notes.length; i++) {
    page.drawText(`${i + 1}.  ${notes[i]}`, { x: x + colPad + 4, y: ly, size: 6.5, font, color: C.black });
    ly -= 10;
  }

  // ── Right column: layer + material info ──────────────────────────────────
  let ry = y + h - LABEL_H - colPad - 8;

  const layerName = layer.label || `Layer ${layerIdx + 1}`;

  page.drawText("LAYER DETAILS:", { x: midX + colPad, y: ry, size: 7, font: fontBold, color: C.black });
  ry -= 12;

  const details: Array<[string, string]> = [
    ["Layer",       `${layerName}  (${layerIdx + 1} of ${totalLayers})`],
    ["Thickness",   `${layer.thicknessIn.toFixed(3)}"`],
    ["Material",    layer.materialName || "—"],
    ["Block L",     `${input.block.lengthIn.toFixed(3)}"`],
    ["Block W",     `${input.block.widthIn.toFixed(3)}"`],
    ["Cavities",    layer.cavities.length > 0 ? `${layer.cavities.length} cavity(ies)` : "None"],
  ];

  for (const [label, val] of details) {
    page.drawText(`${label}:`, { x: midX + colPad, y: ry, size: 6.5, font: fontBold, color: C.black });
    page.drawText(val, { x: midX + colPad + 58, y: ry, size: 6.5, font, color: C.black });
    ry -= 10;
  }

  // Cavity table (if any)
  if (layer.cavities.length > 0) {
    ry -= 4;
    page.drawText("CAVITY SCHEDULE:", { x: midX + colPad, y: ry, size: 7, font: fontBold, color: C.black });
    ry -= 11;

    // Header
    const cols = [
      { label: "#",      x: midX + colPad,      w: 14 },
      { label: "L\"",    x: midX + colPad + 16,  w: 28 },
      { label: "W\"",    x: midX + colPad + 46,  w: 28 },
      { label: "D\"",    x: midX + colPad + 76,  w: 28 },
      { label: "SHAPE",  x: midX + colPad + 106, w: 40 },
    ];
    for (const col of cols) {
      page.drawText(col.label, { x: col.x, y: ry, size: 6, font: fontBold, color: C.black });
    }
    ry -= 9;

    // Divider
    page.drawLine({ start:{x: midX + colPad, y: ry + 2}, end:{x: midX + w * 0.46, y: ry + 2}, thickness: 0.4, color: C.dimLine });
    ry -= 2;

    for (let ci = 0; ci < layer.cavities.length; ci++) {
      const cav = layer.cavities[ci];
      const row = [
        String(ci + 1),
        cav.lengthIn.toFixed(3),
        cav.widthIn.toFixed(3),
        cav.depthIn.toFixed(3),
        cav.shape.toUpperCase(),
      ];
      for (let ri = 0; ri < cols.length; ri++) {
        page.drawText(row[ri], { x: cols[ri].x, y: ry, size: 6, font, color: C.black });
      }
      ry -= 9;
      if (ry < y + 6) break; // safety: don't overflow panel
    }
  }
}

// ─── FRONT VIEW  (L × H of this layer) ───────────────────────────────────────

function frontView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  const DIM  = 24;
  const LPAD = 24; // left pad (space for layer label outside shape)

  const avW = cw - LPAD - DIM - 8;
  const avH = ch - DIM - 8;

  const scale = Math.min(avW / block.lengthIn, avH / layer.thicknessIn) * 0.82;
  const sW    = block.lengthIn * scale;
  const sH    = layer.thicknessIn * scale;

  const sx = cx + LPAD + (avW - sW) / 2;
  const sy = cy + DIM + (avH - sH) / 2;

  page.drawRectangle({ x:sx, y:sy, width:sW, height:sH, color:C.foam, borderColor:C.black, borderWidth:1.5 });

  // Cavities: length × depth, hanging from top of layer
  for (const cav of layer.cavities) {
    const cavX = sx + cav.x * block.lengthIn * scale;
    const cavW = cav.lengthIn * scale;
    const cavH = Math.min(cav.depthIn, layer.thicknessIn) * scale;
    const cavY = sy + sH - cavH;
    dashedRect(page, cavX, cavY, cavW, cavH, C.cavityLine, 0.75);

    if (cavW > 20) {
      horizDim(page, cavX, cavX+cavW, cavY, cy + DIM*0.4, cav.lengthIn, font, 6);
    }
    if (cavH > 14 && cavX + cavW + DIM < cx + cw - 4) {
      vertDim(page, cavY, cavY+cavH, cavX+cavW, cavX+cavW+DIM-4, cav.depthIn, font, 6);
    }
  }

  // Overall dims
  horizDim(page, sx, sx+sW, sy, sy - DIM + 4, block.lengthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx+sW, sx+sW+DIM-4, layer.thicknessIn, font, 7.5);
}

// ─── TOP VIEW  (L × W, cavity plan) ──────────────────────────────────────────

function topView(
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

  page.drawRectangle({ x:sx, y:sy, width:sW, height:sH, color:C.foam, borderColor:C.black, borderWidth:1.5 });

  for (const cav of layer.cavities) {
    if (cav.shape === "circle") {
      const diam = cav.diameterIn || Math.min(cav.lengthIn, cav.widthIn);
      const r    = (diam / 2) * scale;
      const ccx  = sx + (cav.x + cav.lengthIn/2) * block.lengthIn * scale;
      const ccy  = sy + sH - (cav.y + cav.widthIn/2) * block.widthIn * scale;
      page.drawCircle({ x:ccx, y:ccy, size:r, borderColor:C.cavityLine, borderWidth:0.75, borderDashArray:[3,2] });
      if (r * 2 > 14) {
        horizDim(page, ccx-r, ccx+r, ccy, ccy - DIM + 4, diam, font, 6);
      }
    } else {
      const cavX = sx + cav.x * block.lengthIn * scale;
      const cavY = sy + sH - (cav.y + cav.widthIn) * block.widthIn * scale;
      const cavW = cav.lengthIn * scale;
      const cavH = cav.widthIn * scale;
      dashedRect(page, cavX, cavY, cavW, cavH, C.cavityLine, 0.75);

      if (cavW > 20) {
        horizDim(page, cavX, cavX+cavW, cavY, cy + DIM*0.4, cav.lengthIn, font, 6);
      }
      if (cavH > 14) {
        vertDim(page, cavY, cavY+cavH, cavX, cx + 4, cav.widthIn, font, 6);
      }
    }
  }

  horizDim(page, sx, sx+sW, sy, sy - DIM + 4, block.lengthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx, cx + 4, block.widthIn, font, 7.5);
}

// ─── RIGHT VIEW  (W × H of this layer) ───────────────────────────────────────

function rightView(
  page: PDFPage, cx:number, cy:number, cw:number, ch:number,
  block: Block3D, layer: Layer3D, font: any,
) {
  const DIM  = 24;
  const RPAD = 6;

  const avW = cw - DIM - RPAD - 8;
  const avH = ch - DIM - 8;

  const scale = Math.min(avW / block.widthIn, avH / layer.thicknessIn) * 0.82;
  const sW    = block.widthIn * scale;
  const sH    = layer.thicknessIn * scale;

  const sx = cx + (avW - sW) / 2;
  const sy = cy + DIM + (avH - sH) / 2;

  page.drawRectangle({ x:sx, y:sy, width:sW, height:sH, color:C.foam, borderColor:C.black, borderWidth:1.5 });

  // Cavities: width (Y) × depth cross-section
  for (const cav of layer.cavities) {
    const cavX = sx + cav.y * block.widthIn * scale;
    const cavW = cav.widthIn * scale;
    const cavH = Math.min(cav.depthIn, layer.thicknessIn) * scale;
    const cavY = sy + sH - cavH;
    dashedRect(page, cavX, cavY, cavW, cavH, C.cavityLine, 0.75);

    if (cavW > 20) {
      horizDim(page, cavX, cavX+cavW, cavY, cy + DIM*0.4, cav.widthIn, font, 6);
    }
    if (cavH > 14 && cavX + cavW + DIM < cx + cw - 4) {
      vertDim(page, cavY, cavY+cavH, cavX+cavW, cavX+cavW+DIM-4, cav.depthIn, font, 6);
    }
  }

  horizDim(page, sx, sx+sW, sy, sy - DIM + 4, block.widthIn, font, 7.5);
  vertDim (page, sy, sy+sH, sx+sW, sx+sW+DIM-4, layer.thicknessIn, font, 7.5);
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

  page.drawText(title,          { x:x+12, y:y+h-22, size:13, font:fontBold, color:C.titleFg });
  page.drawLine({ start:{x, y:y+h-28}, end:{x:x+leftW, y:y+h-28}, thickness:0.5, color:C.gridLight });
  page.drawText(`Quote: ${quoteNo}`, { x:x+12, y:y+h-44, size:9, font, color:C.titleFg });
  if (customerName) {
    page.drawText(`Customer: ${customerName}`, { x:x+12, y:y+h-57, size:9, font, color:C.titleFg });
  }
  page.drawText("FOR MANUFACTURING USE ONLY \u2013 INTERNAL DOCUMENT",
    { x:x+12, y:y+10, size:7, font, color:rgb(0.55, 0.55, 0.55) });

  const boxW = (w - leftW) / 2;
  const boxH = h / 2;
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
  page: PDFPage,
  x1:number, x2:number,
  shapeEdgeY:number, dimY:number,
  val:number, font:any, textSize:number = 7.5,
) {
  if (Math.abs(x2 - x1) < 6) return;
  const col = C.dimLine, asz = 3.5;
  page.drawLine({ start:{x:x1, y:shapeEdgeY-2}, end:{x:x1, y:dimY+3},  thickness:0.5, color:col });
  page.drawLine({ start:{x:x2, y:shapeEdgeY-2}, end:{x:x2, y:dimY+3},  thickness:0.5, color:col });
  page.drawLine({ start:{x:x1, y:dimY},          end:{x:x2, y:dimY},   thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x1+asz, y:dimY+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x1,y:dimY}, end:{x:x1+asz, y:dimY-asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:dimY}, end:{x:x2-asz, y:dimY+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:x2,y:dimY}, end:{x:x2-asz, y:dimY-asz}, thickness:0.5, color:col });
  const txt = `${val.toFixed(2)}"`;
  const tw  = txt.length * (textSize * 0.60);
  const mx  = (x1 + x2) / 2;
  page.drawRectangle({ x:mx-tw/2-2, y:dimY-5, width:tw+4, height:10, color:C.white });
  page.drawText(txt, { x:mx-tw/2, y:dimY-3, size:textSize, font, color:C.black });
}

function vertDim(
  page: PDFPage,
  y1:number, y2:number,
  shapeEdgeX:number, dimX:number,
  val:number, font:any, textSize:number = 7.5,
) {
  if (Math.abs(y2 - y1) < 6) return;
  const col = C.dimLine, asz = 3.5;
  page.drawLine({ start:{x:shapeEdgeX+2, y:y1}, end:{x:dimX-3, y:y1}, thickness:0.5, color:col });
  page.drawLine({ start:{x:shapeEdgeX+2, y:y2}, end:{x:dimX-3, y:y2}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX, y:y1},          end:{x:dimX, y:y2},  thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX-asz, y:y1+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y1}, end:{x:dimX+asz, y:y1+asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y2}, end:{x:dimX-asz, y:y2-asz}, thickness:0.5, color:col });
  page.drawLine({ start:{x:dimX,y:y2}, end:{x:dimX+asz, y:y2-asz}, thickness:0.5, color:col });
  const txt = `${val.toFixed(2)}"`;
  const my  = (y1 + y2) / 2;
  const tw  = txt.length * (textSize * 0.60);
  page.drawRectangle({ x:dimX-tw/2-2, y:my-5, width:tw+4, height:10, color:C.white });
  page.drawText(txt, { x:dimX-tw/2, y:my-3, size:textSize, font, color:C.black });
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function dashedRect(page: PDFPage, x:number, y:number, w:number, h:number,
  color: ReturnType<typeof rgb>, thickness:number) {
  page.drawRectangle({ x, y, width:w, height:h, borderColor:color, borderWidth:thickness, borderDashArray:[3,2] });
}