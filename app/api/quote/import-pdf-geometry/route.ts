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
    // Run Python extraction script
    const pythonScript = `
import sys
sys.path.insert(0, '/usr/local/lib/python3.12/dist-packages')
import pdfplumber
import json

with pdfplumber.open('${tempPdf}') as pdf:
    page = pdf.pages[0]
    pts_to_inches = 1/72
    
    curves = page.curves
    shapes = []
    
    # Find the largest shape (block boundary)
    largest_area = 0
    block_shape = None
    
    for curve in curves:
        width_in = curve['width'] * pts_to_inches
        height_in = curve['height'] * pts_to_inches
        area = width_in * height_in
        
        if area > largest_area:
            largest_area = area
            block_shape = {'width': width_in, 'height': height_in}
    
    # Extract cavities (smaller shapes)
    for curve in curves:
        width_pts = curve['width']
        height_pts = curve['height']
        width_in = width_pts * pts_to_inches
        height_in = height_pts * pts_to_inches
        
        # Skip the block boundary
        if block_shape and abs(width_in - block_shape['width']) < 0.5:
            continue
        
        # Center position (PDF Y-axis goes up from bottom)
        center_x_pts = (curve['x0'] + curve['x1']) / 2
        center_y_pts = (curve['y0'] + curve['y1']) / 2
        
        # Convert to top-left origin for editor
        page_height_pts = page.height
        center_y_from_top_pts = page_height_pts - center_y_pts
        
        center_x_in = center_x_pts * pts_to_inches
        center_y_in = center_y_from_top_pts * pts_to_inches
        
        is_circle = abs(width_in - height_in) < 0.1
        
        shapes.append({
            'type': 'circle' if is_circle else 'rect',
            'x': round(center_x_in, 3),
            'y': round(center_y_in, 3),
            'widthIn': round(width_in, 3) if not is_circle else None,
            'heightIn': round(height_in, 3) if not is_circle else None,
            'diameterIn': round(width_in, 3) if is_circle else None
        })
    
    result = {
        'blockWidth': round(block_shape['width'], 2) if block_shape else 12,
        'blockHeight': round(block_shape['height'], 2) if block_shape else 12,
        'shapes': shapes
    }
    
    print(json.dumps(result))
`;
    
    const { stdout } = await execAsync(`python3 -c "${pythonScript.replace(/"/g, '\\"')}"`);
    const result = JSON.parse(stdout.trim());
    
    // Remove duplicates (shapes at same position)
    const uniqueShapes: ExtractedShape[] = [];
    const seen = new Set<string>();
    
    for (const shape of result.shapes) {
      const key = `${shape.type}_${shape.x}_${shape.y}`;
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