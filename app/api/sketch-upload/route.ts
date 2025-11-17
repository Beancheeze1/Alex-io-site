// app/api/sketch-upload/route.ts
//
// Handle "Upload file" from /sketch-upload page.
// - Saves the file into quote_attachments (with quote_id + quote_no when possible)
// - If the client provided an email, stores it on the quote header (if missing)
// - Calls /api/sketch/parse to run vision
// - Calls /api/sketch/apply to send an updated quote email (Option A)
//
// Returns JSON:
// {
//   ok: true,
//   attachmentId,
//   quoteId,
//   quoteNo,
//   filename,
//   size,
//   type,
//   parsed,        // vision JSON (dims, cavityDims, ...)
//   autoQuote: {   // response from /api/sketch/apply
//     ok: true,
//     ...
//   }
// }

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

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
  size_bytes: number | null;
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

    const quoteNoRaw =
      (form.get("quote_no") as string | null) ||
      (form.get("quoteNo") as string | null) ||
      "";
    const quoteNo = quoteNoRaw.trim() || null;

    const emailRaw = form.get("email") as string | null;
    const email =
      (emailRaw && emailRaw.toString().trim()) || null;

    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const size = buf.length;
    const contentType = file.type || "application/octet-stream";
    const filename =
      file.name || `upload-${Date.now().toString().slice(-6)}.bin`;

    // Resolve quote_id and, if needed, store email onto the quote header
    let quoteId: number | null = null;

    if (quoteNo) {
      const row = await one<{ id: number; email: string | null }>(
        `
        SELECT id, email
        FROM quotes
        WHERE quote_no = $1
        LIMIT 1;
        `,
        [quoteNo]
      );

      if (row) {
        quoteId = row.id;

        // If user provided an email and the quote doesn't have one yet, store it
        if (email && !row.email) {
          const updated = await one<{ id: number; email: string | null }>(
            `
            UPDATE quotes
            SET email = $2
            WHERE id = $1
            RETURNING id, email;
            `,
            [row.id, email]
          );
          if (updated) {
            quoteId = updated.id;
          }
        }
      }
    }

    // Store in quote_attachments
    const inserted = (await one<AttachRow>(
      `
      INSERT INTO quote_attachments
        (quote_id, quote_no, filename, content_type, size_bytes, data)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, quote_id, quote_no, filename, content_type, size_bytes;
      `,
      [quoteId, quoteNo, filename, contentType, size, buf]
    )) as AttachRow | null;

    if (!inserted) {
      return err("insert_failed", "Could not create quote_attachments row", 500);
    }

    const attachmentId = inserted.id;
    const storedQuoteId = inserted.quote_id;
    const storedQuoteNo = inserted.quote_no;

    const base =
      process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    // 1) Call /api/sketch/parse to run vision on the image/PDF
    let parsed: any = null;
    try {
      const parseResp = await fetch(`${base}/api/sketch/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_no: storedQuoteNo,
          attachmentId,
        }),
      });

      const parseJson = await parseResp.json().catch(() => ({} as any));
      if (parseResp.ok && parseJson && parseJson.ok) {
        parsed = parseJson.parsed || null;
      }
    } catch (e) {
      console.error("sketch-upload: parse call failed:", e);
    }

    // 2) Auto-apply the parsed sketch to re-quote + send email
    let autoQuote: any = null;
    try {
      if (storedQuoteNo) {
        const applyResp = await fetch(`${base}/api/sketch/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_no: storedQuoteNo,
            attachmentId,
            parsed,
          }),
        });

        const applyJson = await applyResp.json().catch(() => ({} as any));
        autoQuote = applyJson;
      }
    } catch (e) {
      console.error("sketch-upload: apply call failed:", e);
    }

    return NextResponse.json(
      {
        ok: true,
        attachmentId,
        quoteId: storedQuoteId,
        quoteNo: storedQuoteNo,
        filename: inserted.filename,
        size: inserted.size_bytes,
        type: inserted.content_type,
        parsed,
        autoQuote,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("sketch-upload exception:", e);
    return err(
      "sketch_upload_exception",
      String(e?.message || e),
      500
    );
  }
}
