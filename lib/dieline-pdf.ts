// lib/dieline-pdf.ts
//
// Step 39F: a die line drawn in a VECTOR PDF (what ArtiosCAD, Esko, Illustrator
// and most CAD programs export) -> the same tagged line segments a DXF gives,
// so lib/dieline-import.ts reads, measures, splits and prices it the same way.
//
//   - Page 1 only (a note says when there are more pages).
//   - Only STROKED paths count: filled shapes (logos, solid art), text and
//     images are skipped. Curves are flattened into short lines.
//   - "Layer" = the PDF's optional content (layer) name when the CAD program
//     wrote layers (e.g. "Cut", "Crease"), else "0". "Line" = dashed or
//     solid (the dash pattern). Color = the stroke color, mapped to the same
//     color numbers a DXF uses (1 red, 2 yellow, 3 green, 4 cyan, 5 blue,
//     6 magenta, 7 black / gray / white, 8 anything else). So the usual
//     reading applies: layer names first, then dashed = crease, then red =
//     crease, else cut.
//   - Size: PDF points / 72 = inches, read at full size (1:1). A drawing that
//     was printed to fit the page gets a warning, and staff can set the
//     drawing's scale (lib/dieline-import.ts opts.scale).
//   - A PDF with no stroked lines (a scan or a picture) is refused with
//     error "not_vector".
// Server only (pdfjs-dist's legacy build, run in process, no worker thread).

import type { TaggedSeg } from "@/lib/dxf/parse";

export type DielinePdfLines = {
  segments: TaggedSeg[];
  unitsLabel: string;
  unitsSet: true;
  pdf: { pages: number; page_w_in: number; page_h_in: number; layers: string[] };
};

const MAX_SEGMENTS = 200_000;

/** Stroke color "#rrggbb" -> the DXF color number used for grouping and "red = crease". */
export function pdfColorIndex(hex: string | null | undefined): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!m) return 7;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.2) return 7; // black, gray, white
  const hi = (v: number) => v > 0.55;
  const lo = (v: number) => v < 0.45;
  if (hi(r) && lo(g) && lo(b)) return 1;
  if (hi(r) && hi(g) && lo(b)) return 2;
  if (lo(r) && hi(g) && lo(b)) return 3;
  if (lo(r) && hi(g) && hi(b)) return 4;
  if (lo(r) && lo(g) && hi(b)) return 5;
  if (hi(r) && lo(g) && hi(b)) return 6;
  return 8;
}

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

type PdfjsModule = {
  OPS: Record<string, number>;
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> };
};
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  getOptionalContentConfig: () => Promise<{ getGroup: (id: string) => { name?: string | null } | null } | null>;
  destroy: () => Promise<void>;
};
type PdfPage = {
  view: number[];
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
};

let pdfjsP: Promise<PdfjsModule> | null = null;
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsP) {
    pdfjsP = (async () => {
      // The worker code runs in this process ("fake worker"); loading it here
      // first means pdfjs doesn't have to find the worker file itself.
      const g = globalThis as { pdfjsWorker?: unknown };
      if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
    })();
  }
  return pdfjsP;
}

/** Is this a PDF file (by its first bytes)? */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

/** A vector PDF die line -> tagged segments in inches (page 1, 1:1). */
export async function pdfDielineLines(
  bytes: Uint8Array,
): Promise<{ ok: true; lines: DielinePdfLines } | { ok: false; error: string; message: string }> {
  if (!looksLikePdf(bytes)) return { ok: false, error: "not_pdf", message: "That file isn't a PDF." };
  let pdfjs: PdfjsModule;
  try {
    pdfjs = await loadPdfjs();
  } catch (e) {
    console.error("[dieline-pdf] pdfjs failed to load", e);
    return { ok: false, error: "pdf_reader", message: "PDF die lines can't be read right now. Please try a DXF." };
  }
  const O = pdfjs.OPS;
  let doc: PdfDoc | null = null;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch {
    return { ok: false, error: "unreadable", message: "We couldn't open that PDF (it may be damaged or password protected)." };
  }
  try {
    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();
    let occ: Awaited<ReturnType<PdfDoc["getOptionalContentConfig"]>> = null;
    try {
      occ = await doc.getOptionalContentConfig();
    } catch {
      occ = null;
    }

    const segments: TaggedSeg[] = [];
    const layersSeen = new Set<string>();
    type GState = { m: M; color: string; dashed: boolean };
    let gs: GState = { m: [1, 0, 0, 1, 0, 0], color: "#000000", dashed: false };
    const stack: GState[] = [];
    const formStack: M[] = [];
    const layerStack: (string | null)[] = [];
    const layerNow = () => {
      for (let i = layerStack.length - 1; i >= 0; i--) if (layerStack[i]) return layerStack[i] as string;
      return "0";
    };
    const STROKE = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);

    const addPath = (data: ArrayLike<number>, closeAll: boolean) => {
      const tag = { layer: layerNow(), ltype: gs.dashed ? "DASHED" : "CONTINUOUS", dashed: gs.dashed, color: pdfColorIndex(gs.color) };
      layersSeen.add(tag.layer);
      let start: { x: number; y: number } | null = null;
      let cur: { x: number; y: number } | null = null;
      const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        if (segments.length >= MAX_SEGMENTS) return;
        const p = apply(gs.m, a.x, a.y);
        const q = apply(gs.m, b.x, b.y);
        segments.push({ x1: p.x / 72, y1: p.y / 72, x2: q.x / 72, y2: q.y / 72, tag });
      };
      let i = 0;
      while (i < data.length) {
        const op = data[i];
        if (op === 0) {
          // moveTo
          if (closeAll && start && cur && (cur.x !== start.x || cur.y !== start.y)) line(cur, start);
          cur = { x: data[i + 1], y: data[i + 2] };
          start = cur;
          i += 3;
        } else if (op === 1) {
          const nxt = { x: data[i + 1], y: data[i + 2] };
          if (cur) line(cur, nxt);
          cur = nxt;
          i += 3;
        } else if (op === 2) {
          // cubic bezier -> 12 short lines
          const p0 = cur ?? { x: data[i + 1], y: data[i + 2] };
          const [x1, y1, x2, y2, x3, y3] = [data[i + 1], data[i + 2], data[i + 3], data[i + 4], data[i + 5], data[i + 6]];
          let prev = p0;
          for (let k = 1; k <= 12; k++) {
            const t = k / 12;
            const u = 1 - t;
            const pt = {
              x: u * u * u * p0.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
              y: u * u * u * p0.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
            };
            line(prev, pt);
            prev = pt;
          }
          cur = { x: x3, y: y3 };
          i += 7;
        } else if (op === 3) {
          // closePath (pdfjs DrawOPS: 0 moveTo, 1 lineTo, 2 curveTo, 3 closePath; v / y arrive as curveTo)
          if (start && cur && (cur.x !== start.x || cur.y !== start.y)) line(cur, start);
          cur = start;
          i += 1;
        } else {
          break; // unknown drawing op: stop reading this path
        }
      }
      if (closeAll && start && cur && (cur.x !== start.x || cur.y !== start.y)) line(cur, start);
    };

    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      const args = ops.argsArray[k] as unknown[] | null;
      if (fn === O.save) stack.push({ ...gs, m: [...gs.m] as M });
      else if (fn === O.restore) gs = stack.pop() ?? gs;
      else if (fn === O.transform && args) gs.m = mul(gs.m, args.slice(0, 6).map(Number) as M);
      else if (fn === O.paintFormXObjectBegin && args) {
        formStack.push([...gs.m] as M);
        const fm = args[0] as ArrayLike<number> | null;
        if (fm && fm.length >= 6) gs.m = mul(gs.m, Array.from(fm).slice(0, 6).map(Number) as M);
      } else if (fn === O.paintFormXObjectEnd) gs.m = formStack.pop() ?? gs.m;
      else if (fn === O.setStrokeRGBColor && args) gs.color = String(args[0] ?? "#000000");
      else if (fn === O.setDash && args) {
        const arr = args[0] as ArrayLike<number> | null;
        gs.dashed = !!arr && Array.from(arr).some((v) => Number(v) > 0);
      } else if (fn === O.setGState && args) {
        for (const kv of (args[0] as [string, unknown][]) || []) {
          if (Array.isArray(kv) && kv[0] === "D") {
            const d = kv[1] as [ArrayLike<number>, number] | null;
            gs.dashed = !!d && !!d[0] && Array.from(d[0]).some((v) => Number(v) > 0);
          }
        }
      } else if (fn === O.beginMarkedContentProps && args) {
        let name: string | null = null;
        if (args[0] === "OC") {
          const props = args[1] as { id?: string; type?: string; ids?: string[] } | null;
          const id = props?.id ?? props?.ids?.[0];
          if (id && occ) {
            try {
              name = occ.getGroup(id)?.name ?? null;
            } catch {
              name = null;
            }
          }
        }
        layerStack.push(name ? String(name).slice(0, 80) : null);
      } else if (fn === O.beginMarkedContent) layerStack.push(null);
      else if (fn === O.endMarkedContent) layerStack.pop();
      else if (fn === O.constructPath && args) {
        const paint = Number(args[0]);
        if (!STROKE.has(paint)) continue; // fill-only, clip or no paint
        const paths = args[1] as ArrayLike<number>[] | ArrayLike<number> | null;
        const list: ArrayLike<number>[] = Array.isArray(paths) ? (paths as ArrayLike<number>[]) : paths ? [paths as ArrayLike<number>] : [];
        const closeAll = paint === O.closeStroke || paint === O.closeFillStroke || paint === O.closeEOFillStroke;
        for (const d of list) if (d) addPath(d, closeAll);
      }
    }

    const view = page.view || [0, 0, 612, 792];
    const page_w_in = Math.abs(Number(view[2]) - Number(view[0])) / 72;
    const page_h_in = Math.abs(Number(view[3]) - Number(view[1])) / 72;
    const real = segments.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 1e-6);
    if (real.length === 0) {
      return {
        ok: false,
        error: "not_vector",
        message:
          "That PDF has no drawn lines (it looks like a scan or a picture). Send a DXF, or a PDF exported from your CAD program.",
      };
    }
    return {
      ok: true,
      lines: {
        segments: real,
        unitsLabel: "PDF at full size (1:1)",
        unitsSet: true,
        pdf: {
          pages: doc.numPages,
          page_w_in: Math.round(page_w_in * 1000) / 1000,
          page_h_in: Math.round(page_h_in * 1000) / 1000,
          layers: Array.from(layersSeen).filter((l) => l !== "0"),
        },
      },
    };
  } catch (e) {
    console.error("[dieline-pdf] read failed", e);
    return { ok: false, error: "unreadable", message: "We couldn't read the lines in that PDF." };
  } finally {
    try {
      await doc?.destroy();
    } catch {
      /* ignore */
    }
  }
}
