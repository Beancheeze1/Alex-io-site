// app/api/quote/foam-drawing-preview/route.ts
//
// Step 40: the Start Quote forms (buyer and staff) read a foam drawing before
// the quote exists, to show what the layout editor will open with. POST
// multipart `file` (a .dxf, or a vector .pdf; up to 15 MB) -> nothing saved:
//   { ok, length_in, width_in, cavities, inserts, warnings, svg }
// Errors: { ok: false, error, message }. Public (buyers), 20 per minute per IP.
// The file itself goes to the quote through /api/sketch-upload (drawing=1)
// when the form opens the editor.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { dxfFacesForUpload, facesSummary, MAX_DXF_BYTES } from "@/lib/dxf/upload";
import { pdfFacesForUpload } from "@/lib/dxf/pdf-upload";
import { looksLikePdf } from "@/lib/dieline-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const rate = await rateLimit(req, 20, "foam-drawing-preview");
    if (!rate.success) return rateLimitResponse(rate.reset);

    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    if (!f || typeof f !== "object" || !("arrayBuffer" in f)) {
      return json({ ok: false, error: "missing_file", message: "Choose a drawing file." }, 400);
    }
    const file = f as File;
    const name = String(file.name || "drawing").slice(0, 200);
    if (!/\.(dxf|pdf)$/i.test(name)) {
      return json({ ok: false, error: "wrong_type", message: "Upload your drawing as a .dxf file or a vector .pdf." }, 400);
    }
    if (file.size > MAX_DXF_BYTES) return json({ ok: false, error: "too_big", message: "That file is over 15 MB." }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const isPdf = /\.pdf$/i.test(name) || looksLikePdf(bytes);
    const read = isPdf ? await pdfFacesForUpload(new Uint8Array(bytes)) : dxfFacesForUpload(bytes);
    if (!read.ok) return json({ ok: false, error: "unreadable", message: read.message }, 422);
    return json({ ok: true, ...facesSummary(read.faces) });
  } catch (e) {
    console.error("[quote/foam-drawing-preview] failed:", e);
    return json({ ok: false, error: "server_error", message: "We couldn't read that drawing. Please try again." }, 500);
  }
}
