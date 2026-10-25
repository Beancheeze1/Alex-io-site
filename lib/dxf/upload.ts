// lib/dxf/upload.ts
//
// Step 37A2: turns an uploaded DXF into the forge_faces.json the layout
// editor seeds from (see lib/dxf/parse.ts). The top level is the first
// insert, so every existing reader of forge_faces.json keeps working; a
// drawing with more than one insert also lists all of them in `inserts`.
// Pure (tested in scripts/test-dxf.ts). Step 40: a vector PDF drawing goes
// through lib/dxf/pdf-upload.ts (server only) and storedFaces here.

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
  return storedFaces(r, "DXF");
}

/** Step 40: inserts -> what's stored as forge_faces.json (DXF or PDF), or why not. */
export function storedFaces(
  r: { inserts: DxfFaces[]; warnings: string[] },
  kind: "DXF" | "PDF",
): { ok: true; faces: StoredDxfFaces } | { ok: false; message: string } {
  if (!r.inserts.length) {
    return {
      ok: false,
      message:
        `We couldn't find a closed outline in this ${kind}. Make sure the outside of the part is one closed shape ` +
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

/** Step 40: what the Start Quote form shows for a foam drawing (nothing saved). */
export type FacesSummary = {
  length_in: number;
  width_in: number;
  cavities: number; // pockets in the first insert
  inserts: number; // separate parts in the drawing (the editor opens the first and offers the rest)
  warnings: string[];
  svg: string; // a small drawing of the first insert: numbers and our own markup only
};

export function facesSummary(faces: StoredDxfFaces): FacesSummary {
  const loops = Array.isArray(faces.loops) ? faces.loops : [];
  const outer = loops[faces.outerLoopIndex ?? 0] ?? loops[0];
  const pts = outer?.points ?? [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const pad = 0.04 * Math.max(w, h);
  const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const path = (ps: { x: number; y: number }[]) =>
    ps.length < 2 ? "" : "M" + ps.map((p) => `${n(p.x - minX + pad)} ${n(maxY - p.y + pad)}`).join("L") + "Z";
  const sw = n(Math.max(w, h) / 150);
  const body = loops
    .map((l, i) => {
      const d = path(l.points ?? []);
      if (!d) return "";
      const isOuter = i === (faces.outerLoopIndex ?? 0);
      return `<path d="${d}" fill="${isOuter ? "#f3f4f6" : l.area < 0 ? "#ffffff" : "#f3f4f6"}" stroke="${isOuter ? "#111827" : "#2563eb"}" stroke-width="${sw}"/>`;
    })
    .join("");
  const svg = pts.length
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w + 2 * pad)} ${n(h + 2 * pad)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${body}</svg>`
    : "";
  return {
    length_in: Math.round(w * 1000) / 1000,
    width_in: Math.round(h * 1000) / 1000,
    cavities: loops.filter((l) => Number(l.area) < 0).length,
    inserts: Array.isArray(faces.inserts) && faces.inserts.length > 1 ? faces.inserts.length : 1,
    warnings: Array.isArray(faces.warnings) ? faces.warnings : [],
    svg,
  };
}
