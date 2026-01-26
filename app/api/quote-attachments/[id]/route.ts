// app/api/quote-attachments/[id]/route.ts
//
// Read-only attachment download by id.
// Returns the raw bytes stored in quote_attachments.data with correct headers.
//
// Used by the editor to fetch normalized.dxf (Forge output) by attachmentId.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  data: Buffer;
};

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const rawParam = (ctx?.params?.id ?? "").toString().trim();

    // Fallback: derive from pathname if params are missing in the runtime
    let raw = rawParam;
    if (!raw) {
      try {
        const u = new URL(_req.url);
        const parts = u.pathname.split("/").filter(Boolean);
        raw = (parts[parts.length - 1] ?? "").toString().trim();
      } catch {}
    }

    // Allow only a clean leading integer
    const m = /^(\d+)/.exec(raw);
    const id = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      return err("invalid_id", "id must be a positive number");
    }

    const row = await one<Row>(
      `
      SELECT id, filename, content_type, size_bytes, data
      FROM quote_attachments
      WHERE id = $1
      LIMIT 1;
      `,
      [id],
    );

    if (!row) {
      return err("not_found", `No attachment found for id=${id}`, 404);
    }

    const contentType = row.content_type || "application/octet-stream";
    const filename = row.filename || `attachment-${id}`;

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(row.size_bytes ?? row.data.length));
    headers.set("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
    headers.set("Cache-Control", "no-store");

    const body = new Uint8Array(row.data);
return new NextResponse(body, { status: 200, headers });

  } catch (e: any) {
    console.error("quote-attachments/[id] GET exception:", e);
    return err("attachment_get_exception", String(e?.message || e), 500);
  }
}
