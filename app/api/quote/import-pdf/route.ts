// app/api/quote/import-pdf/route.ts
//
// Import and parse a customer PDF drawing
// Extracts dimensions, materials, quantities from PDF
// Returns parsed data that can be used to populate a quote
//
// POST /api/quote/import-pdf
// Body: { quote_no?: string, attachment_id?: number }
// OR multipart form with PDF file
//
// Returns:
// {
//   ok: true,
//   parsed: { dimensions, materials, qty, notes, ... },
//   attachment_id?: number
// }

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { parsePdfToQuoteData, selectBestDimensions, convertToInches, type ParsedPdfData } from "@/lib/pdf/parser";

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

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    
    let pdfBuffer: Buffer | null = null;
    let attachmentId: number | null = null;
    let quoteNo: string | null = null;
    
    // Handle two input methods:
    // 1. JSON with attachment_id (PDF already uploaded)
    // 2. Multipart form with PDF file
    
    if (contentType.includes("application/json")) {
      const body = await req.json();
      attachmentId = body.attachment_id || null;
      quoteNo = body.quote_no || null;
      
      if (!attachmentId) {
        return err("MISSING_ATTACHMENT_ID", "Provide attachment_id or upload a file", 400);
      }
      
      // Fetch the attachment from database
      const attach = await one<AttachRow>(
        `
        SELECT id, quote_id, quote_no, filename, content_type, data
        FROM quote_attachments
        WHERE id = $1
        `,
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
      // Handle file upload
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
      
      // Optionally store this PDF if quote_no is provided
      if (quoteNo) {
        const stored = await one<{ id: number }>(
          `
          INSERT INTO quote_attachments (quote_no, filename, content_type, size_bytes, data)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
          `,
          [quoteNo, file.name, file.type, pdfBuffer.length, pdfBuffer]
        );
        attachmentId = stored?.id || null;
      }
      
    } else {
      return err("INVALID_CONTENT_TYPE", "Send JSON with attachment_id or multipart/form-data with file", 400);
    }
    
    if (!pdfBuffer) {
      return err("NO_PDF_BUFFER", "Could not obtain PDF data", 500);
    }
    
    // Parse the PDF
    let parsed: ParsedPdfData;
    try {
      parsed = await parsePdfToQuoteData(pdfBuffer);
    } catch (e: any) {
      return err("PDF_PARSE_FAILED", String(e?.message || e), 500);
    }
    
    // Select best dimensions
    const bestDims = selectBestDimensions(parsed.dimensions);
    
    // Helper to safely convert with type checking
    const safeConvert = (val: number | null | undefined, units: "in" | "mm" | null | undefined): number | null => {
      if (val === null || val === undefined) return null;
      return convertToInches(val, units);
    };
    
    // Format response
    const response: any = {
      ok: true,
      parsed: {
        text: parsed.text,
        dimensions: parsed.dimensions,
        bestDimensions: bestDims ? {
          length: bestDims.length ?? null,
          width: bestDims.width ?? null,
          height: bestDims.height ?? null,
          thickness: bestDims.thickness ?? bestDims.height ?? null,
          units: bestDims.units ?? null,
          confidence: bestDims.confidence,
          // Also provide converted to inches
          lengthIn: safeConvert(bestDims.length, bestDims.units),
          widthIn: safeConvert(bestDims.width, bestDims.units),
          heightIn: safeConvert(bestDims.height, bestDims.units),
        } : null,
        materials: parsed.materials,
        qty: parsed.qty,
        notes: parsed.notes,
        metadata: parsed.metadata,
      },
      attachment_id: attachmentId,
      quote_no: quoteNo,
    };
    
    // If we have a quote and good dims, optionally we could auto-update the quote
    // For now, just return the data for the client to handle
    
    return NextResponse.json(response, { status: 200 });
    
  } catch (e: any) {
    console.error("import-pdf exception:", e);
    return err("IMPORT_PDF_EXCEPTION", String(e?.message || e), 500);
  }
}