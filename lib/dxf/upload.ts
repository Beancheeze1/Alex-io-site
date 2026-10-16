// lib/dxf/upload.ts
//
// Step 37A2: turns an uploaded DXF into the forge_faces.json the layout
// editor seeds from (see lib/dxf/parse.ts). The top level is the first
// insert, so every existing reader of forge_faces.json keeps working; a
// drawing with more than one insert also lists all of them in `inserts`.
// Pure (tested in scripts/test-dxf.ts).

import { dxfToFaces, type DxfFaces } from "@/lib/dxf/parse";

export const MAX_DXF_BYTES = 15 * 1024 * 1024;

export type StoredDxfFaces = DxfFaces & { inserts?: DxfFaces[] };

export function dxfFacesForUpload(
  buf: Buffer,
): { ok: true; faces: StoredDxfFaces } | { ok: false; message: string } {
  if (!buf.length) return { ok: false, message: "The DXF file is empty." };
  if (buf.length > MAX_DXF_BYTES) return { ok: false, message: "The DXF file is too large (15 MB max)." };
  const head = buf.subarray(0, 22).toString("latin1");
  if (head.startsWith("AutoCAD Binary DXF")) {
    return { ok: false, message: "This is a binary DXF. Save it as an ASCII DXF and upload it again." };
  }
  let r: ReturnType<typeof dxfToFaces>;
  try {
    r = dxfToFaces(buf.toString("latin1"));
  } catch {
    return { ok: false, message: "We couldn't read this DXF. Try saving it again as an ASCII DXF (2000 or later)." };
  }
  if (!r.inserts.length) {
    return {
      ok: false,
      message:
        "We couldn't find a closed outline in this DXF. Make sure the outside of the part is one closed shape " +
        "(lines and arcs that meet end to end), then upload it again.",
    };
  }
  const first = r.inserts[0];
  const faces: StoredDxfFaces = {
    ...first,
    warnings: r.warnings,
    ...(r.inserts.length > 1 ? { inserts: r.inserts } : {}),
  };
  return { ok: true, faces };
}
