// lib/pdf/threev iew.ts
//
// Generates professional 3-view technical drawings (Front, Top, Right) as PDF
// Uses pdf-lib to create production-ready drawings that export with DXF/STEP

import { PDFDocument, PDFPage, rgb, StandardFonts } from "pdf-lib";

export type Block3D = {
  lengthIn: number; // X dimension
  widthIn: number; // Y dimension
  heightIn: number; // Z dimension (thickness)
};

export type Cavity3D = {
  id: string;
  shape: "rect" | "circle" | "poly";
  // Position in normalized 0-1 coordinates
  x: number; // from left
  y: number; // from top
  lengthIn: number; // X extent
  widthIn: number; // Y extent
  depthIn: number; // Z depth into foam
  // For circles
  diameterIn?: number;
  // For polygons
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
  date?: string; // ISO date string
  notes?: string[];
};

/**
 * Generate a 3-view technical drawing PDF
 * Returns a Buffer containing the PDF
 */
export async function generate3ViewPDF(input: Drawing3DInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  
  // Use landscape orientation for better space utilization
  const page = pdfDoc.addPage([792, 612]); // 11" x 8.5" landscape
  
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // Layout parameters (in PDF points: 72 pts = 1 inch)
  const margin = 36; // 0.5"
  const titleBlockHeight = 80;
  const viewSpacing = 40;
  
  const drawingAreaWidth = page.getWidth() - 2 * margin;
  const drawingAreaHeight = page.getHeight() - 2 * margin - titleBlockHeight;
  
  // Draw title block
  drawTitleBlock(page, {
    x: margin,
    y: margin,
    width: drawingAreaWidth,
    height: titleBlockHeight,
    font: helvetica,
    fontBold: helveticaBold,
    quoteNo: input.quoteNo,
    customerName: input.customerName,
    revision: input.revision || "AS",
    date: input.date || new Date().toISOString().split("T")[0],
    title: "FOAM INSERT - 3 VIEW DRAWING",
  });
  
  // Calculate view regions
  const viewAreaY = margin + titleBlockHeight + 20;
  const viewAreaHeight = drawingAreaHeight - 20;
  
  // Divide drawing area into 3 columns
  const viewWidth = (drawingAreaWidth - 2 * viewSpacing) / 3;
  
  const frontViewX = margin;
  const topViewX = margin + viewWidth + viewSpacing;
  const rightViewX = margin + 2 * (viewWidth + viewSpacing);
  
  // Draw the three views
  drawFrontView(page, {
    x: frontViewX,
    y: viewAreaY,
    width: viewWidth,
    height: viewAreaHeight,
    block: input.block,
    layers: input.layers,
    font: helvetica,
    fontBold: helveticaBold,
  });
  
  drawTopView(page, {
    x: topViewX,
    y: viewAreaY,
    width: viewWidth,
    height: viewAreaHeight,
    block: input.block,
    layers: input.layers,
    font: helvetica,
    fontBold: helveticaBold,
  });
  
  drawRightView(page, {
    x: rightViewX,
    y: viewAreaY,
    width: viewWidth,
    height: viewAreaHeight,
    block: input.block,
    layers: input.layers,
    font: helvetica,
    fontBold: helveticaBold,
  });
  
  // Draw notes if any
  if (input.notes && input.notes.length > 0) {
    drawNotes(page, {
      x: margin,
      y: viewAreaY + viewAreaHeight + 10,
      width: drawingAreaWidth,
      notes: input.notes,
      font: helvetica,
    });
  }
  
  // Serialize to bytes
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

type TitleBlockParams = {
  x: number;
  y: number;
  width: number;
  height: number;
  font: any;
  fontBold: any;
  quoteNo: string;
  customerName?: string;
  revision: string;
  date: string;
  title: string;
};

function drawTitleBlock(page: PDFPage, params: TitleBlockParams) {
  const { x, y, width, height, font, fontBold } = params;
  
  // Border
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.5,
  });
  
  // Title
  page.drawText(params.title, {
    x: x + 10,
    y: y + height - 20,
    size: 14,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  
  // Quote info
  const infoY = y + height - 45;
  page.drawText(`Quote: ${params.quoteNo}`, {
    x: x + 10,
    y: infoY,
    size: 10,
    font,
    color: rgb(0, 0, 0),
  });
  
  if (params.customerName) {
    page.drawText(`Customer: ${params.customerName}`, {
      x: x + 10,
      y: infoY - 15,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });
  }
  
  // Right side: revision and date
  page.drawText(`Rev: ${params.revision}`, {
    x: x + width - 100,
    y: infoY,
    size: 10,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  
  page.drawText(`Date: ${params.date}`, {
    x: x + width - 100,
    y: infoY - 15,
    size: 10,
    font,
    color: rgb(0, 0, 0),
  });
}

type ViewParams = {
  x: number;
  y: number;
  width: number;
  height: number;
  block: Block3D;
  layers: Layer3D[];
  font: any;
  fontBold: any;
};

/**
 * Front View - looking along Y axis (shows X and Z)
 * This view shows the length (X) and height (Z) of the foam
 */
function drawFrontView(page: PDFPage, params: ViewParams) {
  const { x, y, width, height, block, layers, font, fontBold } = params;
  
  // Label
  page.drawText("FRONT VIEW", {
    x: x + width / 2 - 30,
    y: y + height - 15,
    size: 10,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  
  // Calculate scale to fit
  const blockLength = block.lengthIn;
  const blockHeight = block.heightIn;
  
  const availWidth = width - 40;
  const availHeight = height - 60;
  
  const scaleX = availWidth / blockLength;
  const scaleZ = availHeight / blockHeight;
  const scale = Math.min(scaleX, scaleZ);
  
  const drawWidth = blockLength * scale;
  const drawHeight = blockHeight * scale;
  
  // Center the drawing
  const startX = x + (width - drawWidth) / 2;
  const startY = y + 40; // Leave room at bottom for dimensions
  
  // Draw each layer as a horizontal band
  let currentZ = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const layerHeight = layer.thicknessIn * scale;
    
    // Layer rectangle
    page.drawRectangle({
      x: startX,
      y: startY + currentZ * scale,
      width: drawWidth,
      height: layerHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
      color: i % 2 === 0 ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1),
    });
    
    // Layer label (rotated text would be nice but pdf-lib doesn't support it easily)
    if (layer.label) {
      page.drawText(layer.label, {
        x: startX - 35,
        y: startY + currentZ * scale + layerHeight / 2 - 4,
        size: 7,
        font,
        color: rgb(0, 0, 0),
      });
    }
    
    // Draw cavities as dashed rectangles (front view shows cavity depth)
    for (const cavity of layer.cavities) {
      const cavX = startX + cavity.x * blockLength * scale;
      const cavW = cavity.lengthIn * scale;
      const cavDepth = cavity.depthIn * scale;
      
      // Draw cavity as a rectangle from top of layer
      page.drawRectangle({
        x: cavX,
        y: startY + currentZ * scale + layerHeight - cavDepth,
        width: cavW,
        height: cavDepth,
        borderColor: rgb(0.7, 0, 0),
        borderWidth: 1,
        borderDashArray: [3, 2],
      });
    }
    
    currentZ += layer.thicknessIn;
  }
  
  // Dimension lines
  // Overall length dimension
  drawHorizontalDimension(page, {
    x1: startX,
    x2: startX + drawWidth,
    y: startY - 20,
    value: blockLength,
    units: "in",
    font,
  });
  
  // Overall height dimension
  drawVerticalDimension(page, {
    x: startX + drawWidth + 15,
    y1: startY,
    y2: startY + drawHeight,
    value: blockHeight,
    units: "in",
    font,
  });
}

/**
 * Top View - looking down Z axis (shows X and Y)
 * This view shows the length (X) and width (Y) with all cavities
 */
function drawTopView(page: PDFPage, params: ViewParams) {
  const { x, y, width, height, block, layers, font, fontBold } = params;
  
  // Label
  page.drawText("TOP VIEW", {
    x: x + width / 2 - 25,
    y: y + height - 15,
    size: 10,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  
  const blockLength = block.lengthIn;
  const blockWidth = block.widthIn;
  
  const availWidth = width - 40;
  const availHeight = height - 60;
  
  const scaleX = availWidth / blockLength;
  const scaleY = availHeight / blockWidth;
  const scale = Math.min(scaleX, scaleY);
  
  const drawWidth = blockLength * scale;
  const drawHeight = blockWidth * scale;
  
  const startX = x + (width - drawWidth) / 2;
  const startY = y + 40;
  
  // Draw block outline
  page.drawRectangle({
    x: startX,
    y: startY,
    width: drawWidth,
    height: drawHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.5,
    color: rgb(0.98, 0.98, 0.98),
  });
  
  // Draw all cavities from all layers
  for (const layer of layers) {
    for (const cavity of layer.cavities) {
      if (cavity.shape === "circle") {
        const diameter = cavity.diameterIn || Math.min(cavity.lengthIn, cavity.widthIn);
        const radius = (diameter / 2) * scale;
        const centerX = startX + (cavity.x + cavity.lengthIn / 2) * blockLength * scale;
        const centerY = startY + drawHeight - (cavity.y + cavity.widthIn / 2) * blockWidth * scale;
        
        page.drawCircle({
          x: centerX,
          y: centerY,
          size: radius,
          borderColor: rgb(0.7, 0, 0),
          borderWidth: 1,
          borderDashArray: [3, 2],
        });
        
        // Label cavity
        if (cavity.label) {
          page.drawText(cavity.label, {
            x: centerX - 10,
            y: centerY - 3,
            size: 6,
            font,
            color: rgb(0, 0, 0),
          });
        }
      } else {
        // Rectangle or polygon - simplified to rectangle for now
        const cavX = startX + cavity.x * blockLength * scale;
        const cavY = startY + drawHeight - (cavity.y + cavity.widthIn) * blockWidth * scale;
        const cavW = cavity.lengthIn * scale;
        const cavH = cavity.widthIn * scale;
        
        page.drawRectangle({
          x: cavX,
          y: cavY,
          width: cavW,
          height: cavH,
          borderColor: rgb(0.7, 0, 0),
          borderWidth: 1,
          borderDashArray: [3, 2],
        });
        
        if (cavity.label) {
          page.drawText(cavity.label, {
            x: cavX + cavW / 2 - 10,
            y: cavY + cavH / 2 - 3,
            size: 6,
            font,
            color: rgb(0, 0, 0),
          });
        }
      }
    }
  }
  
  // Dimensions
  drawHorizontalDimension(page, {
    x1: startX,
    x2: startX + drawWidth,
    y: startY - 20,
    value: blockLength,
    units: "in",
    font,
  });
  
  drawVerticalDimension(page, {
    x: startX - 20,
    y1: startY,
    y2: startY + drawHeight,
    value: blockWidth,
    units: "in",
    font,
  });
}

/**
 * Right View - looking along X axis (shows Y and Z)
 * This view shows the width (Y) and height (Z)
 */
function drawRightView(page: PDFPage, params: ViewParams) {
  const { x, y, width, height, block, layers, font, fontBold } = params;
  
  // Label
  page.drawText("RIGHT VIEW", {
    x: x + width / 2 - 30,
    y: y + height - 15,
    size: 10,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  
  const blockWidth = block.widthIn;
  const blockHeight = block.heightIn;
  
  const availWidth = width - 40;
  const availHeight = height - 60;
  
  const scaleY = availWidth / blockWidth;
  const scaleZ = availHeight / blockHeight;
  const scale = Math.min(scaleY, scaleZ);
  
  const drawWidth = blockWidth * scale;
  const drawHeight = blockHeight * scale;
  
  const startX = x + (width - drawWidth) / 2;
  const startY = y + 40;
  
  // Draw each layer
  let currentZ = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const layerHeight = layer.thicknessIn * scale;
    
    page.drawRectangle({
      x: startX,
      y: startY + currentZ * scale,
      width: drawWidth,
      height: layerHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
      color: i % 2 === 0 ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1),
    });
    
    currentZ += layer.thicknessIn;
  }
  
  // Dimensions
  drawHorizontalDimension(page, {
    x1: startX,
    x2: startX + drawWidth,
    y: startY - 20,
    value: blockWidth,
    units: "in",
    font,
  });
  
  drawVerticalDimension(page, {
    x: startX + drawWidth + 15,
    y1: startY,
    y2: startY + drawHeight,
    value: blockHeight,
    units: "in",
    font,
  });
}

type HorizontalDimParams = {
  x1: number;
  x2: number;
  y: number;
  value: number;
  units: string;
  font: any;
};

function drawHorizontalDimension(page: PDFPage, params: HorizontalDimParams) {
  const { x1, x2, y, value, units, font } = params;
  
  // Extension lines
  page.drawLine({
    start: { x: x1, y: y - 5 },
    end: { x: x1, y: y + 5 },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  page.drawLine({
    start: { x: x2, y: y - 5 },
    end: { x: x2, y: y + 5 },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  // Dimension line
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  // Arrowheads
  const arrowSize = 3;
  page.drawLine({
    start: { x: x1, y },
    end: { x: x1 + arrowSize, y: y + arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: x1, y },
    end: { x: x1 + arrowSize, y: y - arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: x2, y },
    end: { x: x2 - arrowSize, y: y + arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: x2, y },
    end: { x: x2 - arrowSize, y: y - arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  // Text
  const text = `${value.toFixed(2)}"`;
  const textWidth = text.length * 5; // Rough estimate
  page.drawText(text, {
    x: (x1 + x2) / 2 - textWidth / 2,
    y: y + 8,
    size: 8,
    font,
    color: rgb(0, 0, 0),
  });
}

type VerticalDimParams = {
  x: number;
  y1: number;
  y2: number;
  value: number;
  units: string;
  font: any;
};

function drawVerticalDimension(page: PDFPage, params: VerticalDimParams) {
  const { x, y1, y2, value, units, font } = params;
  
  // Extension lines
  page.drawLine({
    start: { x: x - 5, y: y1 },
    end: { x: x + 5, y: y1 },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  page.drawLine({
    start: { x: x - 5, y: y2 },
    end: { x: x + 5, y: y2 },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  // Dimension line
  page.drawLine({
    start: { x, y: y1 },
    end: { x, y: y2 },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  // Arrowheads
  const arrowSize = 3;
  page.drawLine({
    start: { x, y: y1 },
    end: { x: x + arrowSize, y: y1 + arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x, y: y1 },
    end: { x: x - arrowSize, y: y1 + arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x, y: y2 },
    end: { x: x + arrowSize, y: y2 - arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x, y: y2 },
    end: { x: x - arrowSize, y: y2 - arrowSize },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  
  // Text (rotated would be better but pdf-lib doesn't make it easy)
  const text = `${value.toFixed(2)}"`;
  page.drawText(text, {
    x: x + 8,
    y: (y1 + y2) / 2 - 3,
    size: 8,
    font,
    color: rgb(0, 0, 0),
  });
}

type NotesParams = {
  x: number;
  y: number;
  width: number;
  notes: string[];
  font: any;
};

function drawNotes(page: PDFPage, params: NotesParams) {
  const { x, y, width, notes, font } = params;
  
  page.drawText("NOTES:", {
    x,
    y,
    size: 8,
    font,
    color: rgb(0, 0, 0),
  });
  
  let currentY = y - 12;
  for (let i = 0; i < notes.length; i++) {
    page.drawText(`${i + 1}. ${notes[i]}`, {
      x,
      y: currentY,
      size: 7,
      font,
      color: rgb(0, 0, 0),
    });
    currentY -= 10;
  }
}