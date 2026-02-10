// app/api/quote-attachments/save-pdf/route.ts
//
// Simple endpoint to save PDF files directly to quote_attachments
// Bypasses forge processing which doesn't work for PDFs
//
// POST /api/quote-attachments/save-pdf
// Body: FormData with file, quote_no

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

type QuoteRow = {
  id: number;
  quote_no: string;
};

type AttachRow = {
  id: number;
  quote_id: number | null;
  quote_no: string | null;
  filename: string;
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return err("invalid_form", "Expected multipart/form-data");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return err("missing_file", "file is required");
    }

    const quoteNoRaw = form.get("quote_no") as string | null;
    const quoteNo = (quoteNoRaw && quoteNoRaw.trim()) || null;

    if (!quoteNo) {
      return err("missing_quote_no", "quote_no is required");
    }

    // Verify quote exists
    const quote = await one<QuoteRow>(
      `SELECT id, quote_no FROM quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo]
    );

    if (!quote) {
      return err("quote_not_found", { quoteNo }, 404);
    }

    // Read file data
    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const contentType = file.type || "application/pdf";
    const filename = file.name;

    // Save to database
    const inserted = await one<AttachRow>(
      `
      INSERT INTO quote_attachments
        (quote_id, quote_no, filename, content_type, size_bytes, data)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, quote_id, quote_no, filename;
      `,
      [quote.id, quote.quote_no, filename, contentType, buf.length, buf]
    );

    if (!inserted) {
      return err("insert_failed", "Could not save PDF to database", 500);
    }

    return NextResponse.json(
      {
        ok: true,
        id: inserted.id,
        attachmentId: inserted.id,
        quote_id: inserted.quote_id,
        quote_no: inserted.quote_no,
        filename: inserted.filename,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("save-pdf exception:", e);
    return err("save_pdf_exception", String(e?.message || e), 500);
  }
}