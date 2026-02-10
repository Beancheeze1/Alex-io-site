// app/api/quote/import-pdf-geometry/route.ts
//
// Extract vector geometry (shapes) from PDF files
// Returns shapes that can be imported as cavities in the layout editor
//
// POST /api/quote/import-pdf-geometry
// Body: { attachment_id: number } or multipart with file

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

type AttachRow = {
  id: number;
  quote_id: number | null;
  quote_no: string | null;
  filename: string;
  content_type: string | null;
  data: Buffer;
};

export type ExtractedShape = {
  type: "rect" | "circle";
  x: number;  // Center X in inches
  y: number;  // Center Y in inches
  lengthIn?: number;  // For rectangles
  widthIn?: number;   // For rectangles
  diameterIn?: number; // For circles
};

export type GeometryExtractionResult = {
  ok: true;
  blockDimensions: {
    lengthIn: number;
    widthIn: number;
  };
  cavities: ExtractedShape[];
  attachment_id?: number;
  quote_no?: string;
};

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    
    let pdfBuffer: Buffer | null = null;
    let attachmentId: number | null = null;
    let quoteNo: string | null = null;
    
    // Handle two input methods
    if (contentType.includes("application/json")) {
      const body = await req.json();
      attachmentId = body.attachment_id || null;
      quoteNo = body.quote_no || null;
      
      if (!attachmentId) {
        return err("MISSING_ATTACHMENT_ID", "Provide attachment_id or upload a file", 400);
      }
      
      const attach = await one<AttachRow>(
        `SELECT id, quote_id, quote_no, filename, content_type, data
         FROM quote_attachments
         WHERE id = $1`,
        [attachmentId]
      );
      
      if (!attach) {
        return err("ATTACHMENT_NOT_FOUND", `No attachment with id=${attachmentId}`, 404);
      }
      
      const ct = (attach.content_type || "").toLowerCase();
      if (!ct.includes("pdf") && !attach.filename.toLowerCase().endsWith(".pdf")) {
        return err("NOT_A_PDF", "Attachment is not a PDF file", 400);
      }
      
      pdfBuffer = attach.data;
      quoteNo = quoteNo || attach.quote_no;
      
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      quoteNo = formData.get("quote_no") as string | null;
      
      if (!file) {
        return err("NO_FILE", "No file provided in multipart form", 400);
      }
      
      if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        return err("NOT_A_PDF", "File must be a PDF", 400);
      }
      
      const arrayBuffer = await file.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);
      
    } else {
      return err("INVALID_CONTENT_TYPE", "Send JSON with attachment_id or multipart/form-data with file", 400);
    }
    
    if (!pdfBuffer) {
      return err("NO_PDF_BUFFER", "Could not obtain PDF data", 500);
    }
    
    // Extract geometry using Python script
    const geometry = await extractPdfGeometry(pdfBuffer);
    
    const response: GeometryExtractionResult = {
      ok: true,
      blockDimensions: geometry.blockDimensions,
      cavities: geometry.cavities,
      attachment_id: attachmentId || undefined,
      quote_no: quoteNo || undefined,
    };
    
    return NextResponse.json(response, { status: 200 });
    
  } catch (e: any) {
    console.error("import-pdf-geometry exception:", e);
    return err("GEOMETRY_EXTRACTION_EXCEPTION", String(e?.message || e), 500);
  }
}

/**
 * Extract vector shapes from PDF using pdfplumber
 */
async function extractPdfGeometry(pdfBuffer: Buffer): Promise<{
  blockDimensions: { lengthIn: number; widthIn: number };
  cavities: ExtractedShape[];
}> {
  // Write PDF to temp file
  const tempPdf = join(tmpdir(), `pdf_${Date.now()}.pdf`);
  await writeFile(tempPdf, pdfBuffer);
  
  try {
    // Create Python script file
    const scriptPath = join(tmpdir(), `extract_${Date.now()}.py`);
    const pythonScript = `#!/usr/bin/env python3
import sys
import json

# Add common package paths
sys.path.insert(0, '/usr/local/lib/python3.12/dist-packages')
sys.path.insert(0, '/usr/local/lib/python3.12/site-packages')
sys.path.insert(0, '/opt/render/.local/lib/python3.12/site-packages')

import pdfplumber

pdf_path = '${tempPdf}'

with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    pts_to_inches = 1.0 / 72.0
    
    curves = page.curves
    if not curves:
        print(json.dumps({'blockWidth': 12, 'blockHeight': 12, 'shapes': []}))
        sys.exit(0)
    
    # Find the largest shape by area (this is the block outline)
    largest_area = 0
    largest_curve = None
    
    for curve in curves:
        width_in = curve['width'] * pts_to_inches
        height_in = curve['height'] * pts_to_inches
        area = width_in * height_in
        
        if area > largest_area:
            largest_area = area
            largest_curve = curve
    
    # Block dimensions from largest shape
    block_width_in = largest_curve['width'] * pts_to_inches
    block_height_in = largest_curve['height'] * pts_to_inches
    
    # Block bounds in PDF coordinates
    block_x0 = largest_curve['x0']
    block_y0 = largest_curve['y0']
    block_x1 = largest_curve['x1']
    block_y1 = largest_curve['y1']
    block_center_x = (block_x0 + block_x1) / 2.0
    block_center_y = (block_y0 + block_y1) / 2.0
    
    shapes = []
    
    # Extract cavity shapes (everything except the block outline)
    for curve in curves:
        width_in = curve['width'] * pts_to_inches
        height_in = curve['height'] * pts_to_inches
        
        # Skip if this is the block outline (within 1" tolerance)
        if abs(width_in - block_width_in) < 1.0 and abs(height_in - block_height_in) < 1.0:
            continue
        
        # Cavity center in PDF coordinates
        cavity_x0 = curve['x0']
        cavity_y0 = curve['y0']
        cavity_x1 = curve['x1']
        cavity_y1 = curve['y1']
        cavity_center_x = (cavity_x0 + cavity_x1) / 2.0
        cavity_center_y = (cavity_y0 + cavity_y1) / 2.0
        
        # Position relative to block center (in points)
        rel_x_pts = cavity_center_x - block_center_x
        rel_y_pts = cavity_center_y - block_center_y
        
        # Convert to inches
        rel_x_in = rel_x_pts * pts_to_inches
        rel_y_in = rel_y_pts * pts_to_inches
        
        # Editor coordinate system:
        # - Origin (0, 0) is at top-left of block
        # - X increases to the right
        # - Y increases downward
        # 
        # PDF coordinate system:
        # - Origin is at bottom-left
        # - Y increases upward
        #
        # So: editor_x = block_width/2 + rel_x
        #     editor_y = block_height/2 - rel_y  (flip Y axis)
        
        editor_x = (block_width_in / 2.0) + rel_x_in
        editor_y = (block_height_in / 2.0) - rel_y_in
        
        # Determine shape type
        is_circle = abs(width_in - height_in) < 0.1
        
        shapes.append({
            'type': 'circle' if is_circle else 'rect',
            'x': round(editor_x, 3),
            'y': round(editor_y, 3),
            'widthIn': round(width_in, 3) if not is_circle else None,
            'heightIn': round(height_in, 3) if not is_circle else None,
            'diameterIn': round(width_in, 3) if is_circle else None
        })
    
    result = {
        'blockWidth': round(block_width_in, 2),
        'blockHeight': round(block_height_in, 2),
        'shapes': shapes
    }
    
    print(json.dumps(result))
`;
    
    await writeFile(scriptPath, pythonScript);
    
    // Run Python script
    const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`);
    
    if (stderr && stderr.includes('Error')) {
      console.error('Python stderr:', stderr);
    }
    
    const result = JSON.parse(stdout.trim());
    
    // Clean up
    await unlink(scriptPath).catch(() => {});
    
    // Remove duplicates (shapes at same position)
    const uniqueShapes: ExtractedShape[] = [];
    const seen = new Set<string>();
    
    for (const shape of result.shapes) {
      const key = `${shape.type}_${shape.x.toFixed(1)}_${shape.y.toFixed(1)}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueShapes.push({
          type: shape.type,
          x: shape.x,
          y: shape.y,
          lengthIn: shape.widthIn,
          widthIn: shape.heightIn,
          diameterIn: shape.diameterIn,
        });
      }
    }
    
    return {
      blockDimensions: {
        lengthIn: result.blockWidth,
        widthIn: result.blockHeight,
      },
      cavities: uniqueShapes,
    };
    
  } finally {
    // Clean up temp file
    await unlink(tempPdf).catch(() => {});
  }
}