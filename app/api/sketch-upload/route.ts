// app/api/sketch-upload/route.ts
import { NextRequest, NextResponse } from "next/server";

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
    const file = formData.get("file") as unknown as File | null;
    const quoteNoRaw = formData.get("quote_no");
    const quoteNo = quoteNoRaw ? String(quoteNoRaw).trim() : null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "missing_file" },
        { status: 400 }
      );
    }

    // NOTE: This is where you would actually persist the file
    // (e.g., to S3 / blob storage) and store a DB record for the quote.
    // For now, we just log metadata so you can confirm it’s working.
    console.log("Received sketch upload", {
      quoteNo,
      filename: file.name,
      size: file.size,
      type: file.type,
    });

    // Example placeholder response
    return NextResponse.json(
      {
        ok: true,
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
