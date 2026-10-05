// app/api/quote-attachments/save-pdf/route.ts
//
// Simple endpoint to save PDF files directly to quote_attachments
// Bypasses forge processing which doesn't work for PDFs
//
// POST /api/quote-attachments/save-pdf
// Body: FormData with file, quote_no

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { findOrCreateUploadDraft } from "@/lib/quote-draft";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_PDF_BYTES = 8 * 1024 * 1024;

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
};

export async function POST(req: NextRequest) {
  try {
    const rate = await rateLimit(req, 10, "save-pdf");
    if (!rate.success) return rateLimitResponse(rate.reset);

    const form = await req.formData().catch(() => null);
    if (!form) {
      return err("invalid_form", "Expected multipart/form-data");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return err("missing_file", "file is required");
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return err("not_a_pdf", "Only PDF files are accepted here.");
    }
    if (file.size > MAX_PDF_BYTES) {
      return err("too_large", "PDF must be 8 MB or less.", 413);
    }

    const quoteNoRaw = form.get("quote_no") as string | null;
    const quoteNo = (quoteNoRaw && quoteNoRaw.trim()) || null;

    if (!quoteNo) {
      return err("missing_quote_no", "quote_no is required");
    }

    // Existing quote, or — public editor before the first Apply — a new
    // empty draft (lib/quote-draft.ts) so the PDF has somewhere to go.
    const quote = await findOrCreateUploadDraft(req, {
      quoteNo,
      tenantSlug: (form.get("tenant_slug") as string | null) || null,
      quoteSource: (form.get("quote_source") as string | null) || null,
    });

    if (!quote) {
      return err("quote_not_found", { quoteNo }, 404);
    }

    // Read file data
    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const contentType = "application/pdf";
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