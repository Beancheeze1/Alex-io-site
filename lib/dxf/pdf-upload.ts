// lib/dxf/pdf-upload.ts
//
// Step 40: a foam drawing in a VECTOR PDF -> the forge_faces.json the layout
// editor seeds from, the same way a DXF is read (lib/dxf/upload.ts). The PDF
// is read by the display die line reader (lib/dieline-pdf.ts): page 1, full
// size (PDF points / 72 = inches), stroked lines only (text, fills and
// pictures are skipped), curves flattened. A loop around (nearly) the whole
// page is the drawing's border and is skipped; inserts are listed biggest
// first. Server only (pdfjs).

import { pdfDielineLines } from "@/lib/dieline-pdf";
import { facesFromSegments } from "@/lib/dxf/parse";
import { storedFaces, type StoredDxfFaces } from "@/lib/dxf/upload";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export async function pdfFacesForUpload(
  buf: Uint8Array,
): Promise<{ ok: true; faces: StoredDxfFaces } | { ok: false; message: string }> {
  if (!buf.length) return { ok: false, message: "The PDF file is empty." };
  if (buf.length > MAX_PDF_BYTES) return { ok: false, message: "The PDF file is too large (15 MB max)." };
  const read = await pdfDielineLines(buf);
  if (!read.ok) {
    return {
      ok: false,
      message:
        read.error === "not_vector"
          ? "This PDF has no drawn lines (it may be a scan or a picture). Upload the DXF, or a PDF saved from your CAD program."
          : read.message,
    };
  }
  const { segments, pdf } = read.lines;
  const r = facesFromSegments(segments, {
    source: "pdf",
    unitsLabel: "inches (PDF, full size)",
    page: { w: pdf.page_w_in, h: pdf.page_h_in },
  });
  if (pdf.pages > 1) r.warnings.push(`Only page 1 of ${pdf.pages} was read.`);
  return storedFaces(r, "PDF");
}
