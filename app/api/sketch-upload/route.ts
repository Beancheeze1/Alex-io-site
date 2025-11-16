// app/api/sketch-upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return NextResponse.json(
        { ok: false, error: "expected_multipart_formdata" },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const fileAny = formData.get("file");
    const quoteNoRaw = formData.get("quote_no");
    const quoteNo = quoteNoRaw ? String(quoteNoRaw).trim() : null;

    if (!fileAny || typeof (fileAny as any).arrayBuffer !== "function") {
      return NextResponse.json(
        { ok: false, error: "missing_or_invalid_file" },
        { status: 400 }
      );
    }

    const file = fileAny as File;

    // Convert file to Buffer for Postgres bytea
    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    // Try to look up the quote by quote_no (if provided)
    let quoteId: number | null = null;
    if (quoteNo) {
      const row = await one<{ id: number }>(
        "SELECT id FROM quotes WHERE quote_no = $1 LIMIT 1",
        [quoteNo]
      );
      if (row) quoteId = row.id;
    }

    // Insert into quote_attachments
    const inserted = await one<{ id: number }>(
      `
      INSERT INTO quote_attachments
        (quote_id, quote_no, filename, content_type, size_bytes, data)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING id;
      `,
      [
        quoteId,
        quoteNo,
        file.name,
        file.type || null,
        file.size ?? null,
        buf,
      ]
    );

    console.log("Stored sketch upload", {
      attachmentId: inserted?.id,
      quoteId,
      quoteNo,
      filename: file.name,
      size: file.size,
      type: file.type,
    });

    return NextResponse.json(
      {
        ok: true,
        attachmentId: inserted?.id,
        quoteId,
        quoteNo,
        filename: file.name,
        size: file.size,
        type: file.type,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("sketch-upload error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "sketch_upload_exception",
        detail: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}
