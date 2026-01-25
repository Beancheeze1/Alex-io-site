// app/api/quote-attachments/latest/route.ts
//
// Look up the newest attachment id for a quote_no + filename.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const quoteNo = (url.searchParams.get("quote_no") || "").trim();
    const filename = (url.searchParams.get("filename") || "").trim();

    if (!quoteNo || !filename) {
      return err("invalid_params", "quote_no and filename are required");
    }

    const row = await one<Row>(
      `
      SELECT id, filename, content_type, size_bytes
      FROM quote_attachments
      WHERE quote_no = $1 AND filename = $2
      ORDER BY id DESC
      LIMIT 1;
      `,
      [quoteNo, filename],
    );

    if (!row) {
      return err("not_found", "No attachment found", 404);
    }

    return NextResponse.json(
      {
        ok: true,
        attachment: {
          id: row.id,
          filename: row.filename,
          content_type: row.content_type,
          size_bytes: row.size_bytes,
        },
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("quote-attachments/latest GET exception:", e);
    return err("attachment_latest_exception", String(e?.message || e), 500);
  }
}
