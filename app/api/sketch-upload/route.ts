// app/api/sketch-upload/route.ts
//
// Stores uploaded sketch/file into quote_attachments,
// then calls the Vision parser to extract dims/cavities/etc.
//
// Response shape (success):
// {
//   ok: true,
//   attachmentId: 4,
//   quoteId: 31,
//   quoteNo: "Q-AI-20251116-223023",
//   filename: "20251116_162905.jpg",
//   size: 1837540,
//   type: "image/jpeg",
//   parsed: {
//     dims: "...",
//     qty: ...,
//     material: "...",
//     density: "...",
//     cavityCount: ...,
//     cavityDims: [...],
//     notes: "..."
//   }
// }

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return err("expected_multipart_formdata");
    }

    const formData = await req.formData();
    const fileAny = formData.get("file");
    const quoteNoRaw = formData.get("quote_no");
    const quoteNo = quoteNoRaw ? String(quoteNoRaw).trim() : null;

    if (!fileAny || typeof (fileAny as any).arrayBuffer !== "function") {
      return err("missing_or_invalid_file");
    }

    const file = fileAny as File;

    // Convert file to Buffer for Postgres bytea
    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    // Try to look up the quote by quote_no (if provided)
    let quoteId: number | null = null;
    if (quoteNo) {
      const row = await one<{ id: number }>(
        "SELECT id FROM quotes WHERE quote_no = $1 LIMIT 1;",
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

    const attachmentId = inserted?.id;

    console.log("Stored sketch upload", {
      attachmentId,
      quoteId,
      quoteNo,
      filename: file.name,
      size: file.size,
      type: file.type,
    });

    // === Call Vision parser for this attachment (best-effort) ===
    let parsed: any = null;
    try {
      const base =
        process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
        "https://api.alex-io.com";

      const parseResp = await fetch(`${base}/api/sketch/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId }),
      });

      const parseJson = await parseResp.json().catch(() => ({} as any));

      if (parseResp.ok && parseJson?.ok) {
        parsed = parseJson.parsed ?? null;
      } else {
        console.warn("Vision parse call did not return ok:", {
          status: parseResp.status,
          body: parseJson,
        });
      }
    } catch (e) {
      console.error("Vision parse call failed:", e);
    }

    return NextResponse.json(
      {
        ok: true,
        attachmentId,
        quoteId,
        quoteNo,
        filename: file.name,
        size: file.size,
        type: file.type,
        parsed,
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
