// app/api/quote/dieline-preview/route.ts
//
// Step 39F: the Start Quote form reads a DXF die line in the browser, but a
// PDF needs the server's PDF reader. POST multipart `file` (a vector .pdf, or
// a .dxf; up to 5 MB) -> what was read, nothing saved:
//   { ok, units_label, warnings, measure: { length_in, width_in, rule_in, pieces },
//     pieces: [{ piece, length_in, width_in, rule_in }] }   (pieces when > 1)
// Errors: { ok: false, error, message } (not_vector, too_many_parts, ...).
// Public (buyers), 20 per minute per IP. The quote itself is made by
// /api/quote/boxes-only, which reads the file again.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { analyzeDieline, BUYER_DIELINE_MAX_PARTS, splitDieline, type DielineSource } from "@/lib/dieline-import";
import { looksLikePdf, pdfDielineLines } from "@/lib/dieline-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const rate = await rateLimit(req, 20, "dieline-preview");
    if (!rate.success) return rateLimitResponse(rate.reset);

    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    if (!f || typeof f !== "object" || !("arrayBuffer" in f)) {
      return json({ ok: false, error: "missing_file", message: "Choose a die line file." }, 400);
    }
    const file = f as File;
    const name = String(file.name || "dieline").slice(0, 200);
    if (!/\.(dxf|pdf)$/i.test(name)) {
      return json({ ok: false, error: "not_dxf", message: "Upload your die line as a .dxf file or a vector .pdf." }, 400);
    }
    if (file.size > MAX_BYTES) return json({ ok: false, error: "too_big", message: "That file is over 5 MB." }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());

    let src: DielineSource = bytes.toString("utf8");
    if (/\.pdf$/i.test(name) || looksLikePdf(bytes)) {
      const pdf = await pdfDielineLines(bytes);
      if (!pdf.ok) return json({ ok: false, error: pdf.error, message: pdf.message }, 422);
      src = pdf.lines;
    }

    const a = analyzeDieline(src, { split: true });
    if (!a.ok) return json({ ok: false, error: a.error, message: a.message }, 422);
    let pieces: { piece: number; length_in: number; width_in: number; rule_in: number }[] = [];
    if (a.measure.pieces > 1) {
      const sp = splitDieline(src);
      if (!sp.ok) return json({ ok: false, error: sp.error, message: sp.message }, 422);
      if (sp.pieces.length > BUYER_DIELINE_MAX_PARTS) {
        return json(
          {
            ok: false,
            error: "too_many_parts",
            message: `That file has ${sp.pieces.length} separate parts. Online quotes take up to ${BUYER_DIELINE_MAX_PARTS}; send it to the shop and they'll quote it.`,
          },
          422,
        );
      }
      pieces = sp.pieces.map((p) => ({ piece: p.piece, length_in: p.length_in, width_in: p.width_in, rule_in: p.rule_in }));
    }
    return json({
      ok: true,
      units_label: a.units_label,
      warnings: a.warnings,
      measure: { length_in: a.measure.length_in, width_in: a.measure.width_in, rule_in: a.measure.rule_in, pieces: a.measure.pieces },
      pieces,
    });
  } catch (e) {
    console.error("[quote/dieline-preview] failed:", e);
    return json({ ok: false, error: "server_error", message: "We couldn't read that file. Please try again." }, 500);
  }
}
