// lib/dieline-import.ts
//
// Step 39C: read a corrugated die line (DXF) and measure it for quoting.
// Pure (no DB, no network); tested in scripts/test-dieline-import.ts.
//
//   analyzeDieline(text, { roles?, units? })
//     -> line groups (one per layer + linetype + color), each with a role:
//          cut | crease | perf | ignore
//        chosen automatically (in this order):
//          1. layer name: perf / crease-score-fold / cut-knife-outline, or a
//             notes layer (dimensions, text, border, title, bleed, print) = ignore
//          2. a dashed linetype = crease
//          3. red (ACI color 1) = crease (ArtiosCAD-style files)
//          4. anything else = cut
//        Staff can override any group's role (roles: { [groupKey]: role }).
//     -> the blank: the rectangle around every cut / crease / perf line
//        (length = across the drawing, width = up the drawing), in inches
//     -> rule inches: cut, crease, perf and the total (the die estimate and
//        the CAD table path both use the total)
//   Units: the file's $INSUNITS; when the file doesn't set them and the
//   blank would be over 150" across, it's read as millimeters (a warning
//   says so). Staff can force "in" or "mm".

import { buildLoops, parseDxfTagged, pointInPoly, type Pt, type TaggedSeg } from "@/lib/dxf/parse";

export type DielineRole = "cut" | "crease" | "perf" | "ignore";
export const DIELINE_ROLES: readonly DielineRole[] = ["cut", "crease", "perf", "ignore"];

export type DielineGroup = {
  key: string; // layer|ltype|color
  layer: string;
  ltype: string;
  dashed: boolean;
  color: number; // AutoCAD color index
  segments: number;
  length_in: number;
  role: DielineRole; // after any staff override
  auto_role: DielineRole;
  reason: string; // why the auto role was picked
};

export type DielineMeasure = {
  length_in: number; // blank, across the drawing
  width_in: number; // blank, up the drawing
  sqft: number;
  cut_in: number;
  crease_in: number;
  perf_in: number;
  rule_in: number; // cut + crease + perf
  pieces: number; // separate closed outlines found in the cut lines
};

export type DielineAnalysis =
  | {
      ok: true;
      units: "in" | "mm";
      units_label: string;
      scale: number; // Step 39D: drawing units -> inches applied on top of the reader's conversion
      groups: DielineGroup[];
      measure: DielineMeasure;
      warnings: string[];
    }
  | { ok: false; error: string; message: string };

export type DielineUnits = "auto" | "in" | "mm";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const IGNORE_LAYER = /(^|[^A-Z])(DIM|DIMS|DIMENSION|DIMENSIONS|TEXT|NOTE|NOTES|TITLE|BORDER|FRAME|ANNO|ANNOT|BLEED|PRINT|ART|ARTWORK|GRAPHIC|GRAPHICS|GRAIN|REF|REFERENCE|CONSTRUCTION|VIEWPORT|DEFPOINTS)([^A-Z]|$)/;
const PERF_LAYER = /PERF/;
const CREASE_LAYER = /CREASE|SCORE|FOLD|BEND|RILL/;
const CUT_LAYER = /CUT|KNIFE|OUTLINE|TRIM|DIE/;

export function autoRole(tag: { layer: string; dashed: boolean; color: number }): { role: DielineRole; reason: string } {
  const L = tag.layer.toUpperCase();
  if (PERF_LAYER.test(L)) return { role: "perf", reason: `layer "${tag.layer}"` };
  if (CREASE_LAYER.test(L)) return { role: "crease", reason: `layer "${tag.layer}"` };
  if (CUT_LAYER.test(L)) return { role: "cut", reason: `layer "${tag.layer}"` };
  if (IGNORE_LAYER.test(L)) return { role: "ignore", reason: `layer "${tag.layer}" (notes / dimensions)` };
  if (tag.dashed) return { role: "crease", reason: "dashed line" };
  if (tag.color === 1) return { role: "crease", reason: "red line" };
  return { role: "cut", reason: "solid line" };
}

const segLen = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

export function groupKey(t: { layer: string; ltype: string; color: number }): string {
  return `${t.layer}|${t.ltype}|${t.color}`;
}

function isRole(v: unknown): v is DielineRole {
  return typeof v === "string" && (DIELINE_ROLES as readonly string[]).includes(v);
}

/** How many separate outer outlines the cut lines make (parts nested in one file). */
function countPieces(cut: TaggedSeg[], scale: number): number {
  if (cut.length === 0) return 0;
  const { loops } = buildLoops(
    cut.map((s) => ({ x1: s.x1 * scale, y1: s.y1 * scale, x2: s.x2 * scale, y2: s.y2 * scale })),
    0.02,
  );
  const big = loops.filter((lp) => lp.length >= 3);
  // outer = not inside another loop
  const outers = big.filter((lp, i) => !big.some((other, j) => j !== i && other.length >= 3 && inside(lp, other)));
  return Math.max(outers.length, 0);
}
function inside(a: Pt[], b: Pt[]): boolean {
  // a is inside b when its first point is in b and b is bigger
  return pointInPoly(a[0], b) && bboxArea(b) > bboxArea(a);
}
function bboxArea(pts: Pt[]): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return (x1 - x0) * (y1 - y0);
}

/** Step 39D2: a blank this big (inches) is almost surely in the wrong units. */
export const DIELINE_UNITS_CHECK_IN = 400;
export function dielineSizeSuspect(lengthIn: number, widthIn: number): boolean {
  return Math.max(Number(lengthIn) || 0, Number(widthIn) || 0) > DIELINE_UNITS_CHECK_IN;
}

/**
 * Step 39F: lines already read from another format (a vector PDF, see
 * lib/dieline-pdf.ts) in the DXF reader's shape. `pdf` = the page it came from.
 */
export type DielineLines = {
  segments: TaggedSeg[];
  unitsLabel: string;
  unitsSet: boolean;
  pdf?: { pages: number; page_w_in: number; page_h_in: number; layers: string[] };
};
/** A die line: DXF text, or lines read from a PDF. */
export type DielineSource = string | DielineLines;

function toParsed(src: DielineSource): { segments: TaggedSeg[]; unitsLabel: string; unitsSet: boolean } {
  return typeof src === "string" ? parseDxfTagged(src) : src;
}

/** Step 39F: a standard paper page (letter, legal, tabloid, A4, A3), either way round. */
function isPaperPage(w: number, h: number): boolean {
  const sizes = [[8.5, 11], [8.5, 14], [11, 17], [8.27, 11.69], [11.69, 16.54]];
  return sizes.some(([a, b]) => (Math.abs(w - a) < 0.15 && Math.abs(h - b) < 0.15) || (Math.abs(w - b) < 0.15 && Math.abs(h - a) < 0.15));
}

/** Step 39G: a part's own printing: 0-4 colors (spot / flood each) on 1 or 2 sides. */
export type PartPrint = { colors: ("spot" | "flood")[]; sides: 1 | 2 };

/** Step 39G: the part's own printing stored on its dieline blob, or null (= the quote's printing). */
export function partPrintOf(dieline: unknown): PartPrint | null {
  const p = (dieline as { print?: unknown } | null)?.print as { colors?: unknown; sides?: unknown } | null | undefined;
  if (!p || typeof p !== "object" || !Array.isArray(p.colors)) return null;
  const colors = p.colors.filter((c): c is "spot" | "flood" => c === "spot" || c === "flood").slice(0, 4);
  if (colors.length !== p.colors.length) return null;
  return { colors, sides: Number(p.sides) === 2 ? 2 : 1 };
}

/** Step 39F: a drawing scale picked by staff (1 = full size; 2 = drawn at 1:2, so x2). */
export function cleanDielineScale(raw: unknown): number {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : 1;
}

export function analyzeDieline(
  text: DielineSource,
  opts: { roles?: Record<string, unknown> | null; units?: DielineUnits; split?: boolean; scale?: number } = {},
): DielineAnalysis {
  let parsed: { segments: TaggedSeg[]; unitsLabel: string; unitsSet: boolean };
  try {
    parsed = toParsed(text);
  } catch {
    return { ok: false, error: "unreadable", message: "We couldn't read that DXF file." };
  }
  const segs = parsed.segments.filter((s) => segLen(s) > 1e-6);
  if (segs.length === 0) {
    return { ok: false, error: "no_lines", message: "No lines were found in that file (text and dimensions are skipped)." };
  }

  // groups by layer + linetype + color
  const byKey = new Map<string, { tag: TaggedSeg["tag"]; segs: TaggedSeg[] }>();
  for (const s of segs) {
    const k = groupKey(s.tag);
    const g = byKey.get(k);
    if (g) g.segs.push(s);
    else byKey.set(k, { tag: s.tag, segs: [s] });
  }
  const roles = opts.roles || {};
  const warnings: string[] = [];

  // Units: the file's, staff's, or a guess for files that don't say.
  const structural0 = Array.from(byKey.entries()).filter(([, g]) => autoRole(g.tag).role !== "ignore");
  const extent = (list: TaggedSeg[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of list) {
      x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2);
      y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2);
    }
    return { w: x1 - x0, h: y1 - y0 };
  };
  const rawExt = extent(structural0.flatMap(([, g]) => g.segs).concat(structural0.length ? [] : segs));
  // Units: a file that sets $INSUNITS is already in inches (the reader converts).
  // Only a file that doesn't say can be read as mm: chosen by staff, or guessed
  // when it would be over 150" across as inches.
  let units: "in" | "mm" = "in";
  let unitsLabel = parsed.unitsLabel;
  let scale = 1;
  if (parsed.unitsSet) {
    units = /mm|cm|meter/.test(parsed.unitsLabel) ? "mm" : "in";
  } else if (opts.units === "mm") {
    units = "mm";
    scale = 1 / 25.4;
    unitsLabel = "millimeters (chosen)";
  } else if (opts.units === "in") {
    unitsLabel = "inches (chosen)";
  } else if (Math.max(rawExt.w, rawExt.h) > 150) {
    units = "mm";
    scale = 1 / 25.4;
    unitsLabel = "millimeters (guessed: the file doesn't say, and it's over 150 across as inches)";
    warnings.push("The file doesn't say its units, so it was read as millimeters. Switch to inches if that's wrong.");
  }
  // Step 39F: the drawing's scale (staff), and PDF notes
  const drawScale = cleanDielineScale(opts.scale);
  if (drawScale !== 1) {
    scale *= drawScale;
    unitsLabel += drawScale > 1 ? `, drawn at 1:${drawScale}` : `, scaled x${drawScale}`;
  }
  if (typeof text !== "string" && text.pdf) {
    if (text.pdf.pages > 1) warnings.push(`Only page 1 of the PDF was read (it has ${text.pdf.pages} pages).`);
    if (drawScale === 1 && isPaperPage(text.pdf.page_w_in, text.pdf.page_h_in)) {
      warnings.push(
        "This PDF is on a standard paper page. PDFs are read at full size (1:1): if the drawing was printed to fit the page or at a scale, check the blank size and set the drawing scale.",
      );
    }
  }

  const groups: DielineGroup[] = Array.from(byKey.entries())
    .map(([key, g]) => {
      const auto = autoRole(g.tag);
      const override = roles[key];
      return {
        key,
        layer: g.tag.layer,
        ltype: g.tag.ltype,
        dashed: g.tag.dashed,
        color: g.tag.color,
        segments: g.segs.length,
        length_in: r1(g.segs.reduce((n, s) => n + segLen(s), 0) * scale),
        role: isRole(override) ? override : auto.role,
        auto_role: auto.role,
        reason: auto.reason,
      };
    })
    .sort((a, b) => b.length_in - a.length_in);

  const roleOf = new Map(groups.map((g) => [g.key, g.role]));
  const used = segs.filter((s) => roleOf.get(groupKey(s.tag)) !== "ignore");
  if (used.length === 0) {
    return { ok: false, error: "no_rule", message: "Every line is set to ignore. Mark the cut and crease lines." };
  }
  const ext = extent(used);
  const length_in = r3(ext.w * scale);
  const width_in = r3(ext.h * scale);
  const sum = (role: DielineRole) => r1(groups.filter((g) => g.role === role).reduce((n, g) => n + g.length_in, 0));
  const cut_in = sum("cut");
  const crease_in = sum("crease");
  const perf_in = sum("perf");
  const cutSegs = segs.filter((s) => roleOf.get(groupKey(s.tag)) === "cut");
  const pieces = countPieces(cutSegs, scale);

  if (!(length_in > 0 && width_in > 0)) {
    return { ok: false, error: "flat", message: "The lines don't make a blank (no width or no length)." };
  }
  if (dielineSizeSuspect(length_in, width_in)) {
    warnings.push(`The blank is ${length_in.toFixed(1)} × ${width_in.toFixed(1)} in. Check the units.`);
  }
  if (cut_in === 0) warnings.push("No cut lines found. Check which lines are cut.");
  if (crease_in === 0) warnings.push("No crease lines found. If the box folds, mark the crease lines.");
  if (pieces > 1) {
    // Step 39D2: the hint to tick Split only when Split is off.
    warnings.push(
      opts.split
        ? `The cut lines make ${pieces} separate pieces; each is priced as its own part on its own blank.`
        : `The cut lines make ${pieces} separate pieces. As one line they're priced as one blank holding all of them; tick "Split" to price each part on its own blank.`,
    );
  }
  if (groups.some((g) => g.role === "ignore")) {
    const ign = groups.filter((g) => g.role === "ignore").map((g) => g.layer);
    warnings.push(`Not counted: ${Array.from(new Set(ign)).join(", ")}.`);
  }

  return {
    ok: true,
    units,
    units_label: unitsLabel,
    scale,
    groups,
    measure: {
      length_in,
      width_in,
      sqft: r3((length_in * width_in) / 144),
      cut_in,
      crease_in,
      perf_in,
      rule_in: r1(cut_in + crease_in + perf_in),
      pieces,
    },
    warnings,
  };
}

/** The measured blank stored on a box line (quote_box_selections.dieline) and used to price it. */
export type DielineBlank = {
  length_in: number;
  width_in: number;
  cut_in: number;
  crease_in: number;
  perf_in: number;
  rule_in: number;
  filename?: string | null;
  attachment_id?: number | null;
  roles?: Record<string, DielineRole>;
  units?: "in" | "mm";
  per_display?: number; // Step 39D: how many of this part go into one display / set (default 1)
  piece?: number | null; // Step 39D: which piece of a multi-part file (1-based), null = the whole file
  label?: string | null; // Step 39D: staff's name for the part ("Header", "Shelf")
  scale?: number; // Step 39F: the drawing scale staff set (1 = full size); kept for Edit lines
  print?: PartPrint; // Step 39G: this part's own printing (a display part printed differently); none = the quote's
  check?: boolean; // Step 39E: read automatically from a buyer's upload; staff haven't confirmed the lines yet
};

/** A stored dieline blob -> a usable blank, or null. */
export function parseDielineBlank(raw: unknown): DielineBlank | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (k: string) => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v >= 0 ? v : NaN;
  };
  const b = { length_in: n("length_in"), width_in: n("width_in"), cut_in: n("cut_in"), crease_in: n("crease_in"), perf_in: n("perf_in"), rule_in: n("rule_in") };
  if (!(b.length_in > 0 && b.width_in > 0) || ![b.cut_in, b.crease_in, b.perf_in, b.rule_in].every(Number.isFinite)) return null;
  return {
    ...b,
    filename: typeof o.filename === "string" ? o.filename : null,
    attachment_id: Number.isInteger(Number(o.attachment_id)) ? Number(o.attachment_id) : null,
    roles: o.roles && typeof o.roles === "object" ? (o.roles as Record<string, DielineRole>) : undefined,
    units: o.units === "mm" ? "mm" : "in",
    per_display: Number.isInteger(Number(o.per_display)) && Number(o.per_display) >= 1 ? Number(o.per_display) : 1,
    piece: Number.isInteger(Number(o.piece)) && Number(o.piece) >= 1 ? Number(o.piece) : null,
    label: typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 60) : null,
    ...(cleanDielineScale(o.scale) !== 1 ? { scale: cleanDielineScale(o.scale) } : {}),
    ...(partPrintOf(o) ? { print: partPrintOf(o) as PartPrint } : {}),
    ...(o.check === true ? { check: true } : {}),
  };
}

/**
 * Step 39D: one file holding several separate parts (a display's base,
 * header and shelves drawn side by side) -> one measure per part, so each is
 * priced on its own blank instead of one big rectangle around all of them.
 * Parts = the outer outlines of the cut lines; every counted line (cut,
 * crease, perf) goes to the smallest part outline whose box holds its
 * midpoint. Lines outside every part are listed as stray. Same roles and
 * units as analyzeDieline. Pieces are numbered left to right, then top to
 * bottom, so piece numbers stay the same each time the file is read.
 */
export type DielinePiece = DielineMeasure & { piece: number };

export function splitDieline(
  text: DielineSource,
  opts: { roles?: Record<string, unknown> | null; units?: DielineUnits; scale?: number } = {},
): { ok: true; pieces: DielinePiece[]; stray_in: number } | { ok: false; error: string; message: string } {
  const a = analyzeDieline(text, opts);
  if (!a.ok) return a;
  const parsed = toParsed(text);
  const scale = a.scale;
  const roleOf = new Map(a.groups.map((g) => [g.key, g.role]));
  const used = parsed.segments
    .filter((x) => segLen(x) > 1e-6)
    .map((x) => ({
      x1: x.x1 * scale,
      y1: x.y1 * scale,
      x2: x.x2 * scale,
      y2: x.y2 * scale,
      role: roleOf.get(groupKey(x.tag)) ?? "ignore",
    }))
    .filter((x) => x.role !== "ignore");
  const { loops } = buildLoops(used.filter((x) => x.role === "cut"), 0.02);
  const big = loops.filter((lp) => lp.length >= 3);
  const outers = big.filter((lp, i) => !big.some((other, j) => j !== i && other.length >= 3 && inside(lp, other)));
  if (outers.length < 2) return { ok: false, error: "one_piece", message: "This file has one part; there's nothing to split." };
  const boxes = outers
    .map((lp) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of lp) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      return { x0, y0, x1, y1 };
    })
    // left to right, then top to bottom (rows within 1")
    .sort((p, q) => (Math.abs(q.y1 - p.y1) > 1 ? q.y1 - p.y1 : p.x0 - q.x0));
  const tol = 0.05;
  const acc = boxes.map(() => ({ cut: 0, crease: 0, perf: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  let stray = 0;
  for (const sg of used) {
    const mx = (sg.x1 + sg.x2) / 2;
    const my = (sg.y1 + sg.y2) / 2;
    let best = -1;
    let bestArea = Infinity;
    boxes.forEach((b, i) => {
      if (mx >= b.x0 - tol && mx <= b.x1 + tol && my >= b.y0 - tol && my <= b.y1 + tol) {
        const ar = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (ar < bestArea) {
          bestArea = ar;
          best = i;
        }
      }
    });
    const len = segLen(sg);
    if (best < 0) {
      stray += len;
      continue;
    }
    const t = acc[best];
    if (sg.role === "cut") t.cut += len;
    else if (sg.role === "crease") t.crease += len;
    else t.perf += len;
    t.x0 = Math.min(t.x0, sg.x1, sg.x2); t.x1 = Math.max(t.x1, sg.x1, sg.x2);
    t.y0 = Math.min(t.y0, sg.y1, sg.y2); t.y1 = Math.max(t.y1, sg.y1, sg.y2);
  }
  const pieces: DielinePiece[] = acc.map((t, i) => {
    const length_in = r3(t.x1 - t.x0);
    const width_in = r3(t.y1 - t.y0);
    const cut_in = r1(t.cut);
    const crease_in = r1(t.crease);
    const perf_in = r1(t.perf);
    return {
      piece: i + 1,
      length_in,
      width_in,
      sqft: r3((length_in * width_in) / 144),
      cut_in,
      crease_in,
      perf_in,
      rule_in: r1(cut_in + crease_in + perf_in),
      pieces: 1,
    };
  });
  return { ok: true, pieces, stray_in: r1(stray) };
}

/** Step 39E: the most a buyer's quote can hold from one file (more = send it to the shop). */
export const BUYER_DIELINE_MAX_PARTS = 12;

/**
 * Step 39E: a buyer's own die line -> the parts to quote. Lines are read
 * automatically (layer names, dashed, red), and every part is marked
 * `check` so staff confirm the reading. One outline = one part (qty = the
 * buyer's qty). Several separate outlines = a display: one part each, with
 * the buyer's name and count per display for each piece.
 */
export function buyerDielineParts(
  text: DielineSource,
  filename: string,
  asked: { piece?: unknown; label?: unknown; per_display?: unknown }[] = [],
):
  | { ok: true; parts: DielineBlank[]; display: boolean; warnings: string[]; units: "in" | "mm" }
  | { ok: false; error: string; message: string } {
  const a = analyzeDieline(text, { split: true });
  if (!a.ok) return a;
  const base = { filename: String(filename || "dieline.dxf").slice(0, 200), units: a.units, check: true as const };
  if (a.measure.pieces <= 1) {
    const m = a.measure;
    return {
      ok: true,
      display: false,
      units: a.units,
      warnings: a.warnings,
      parts: [
        { length_in: m.length_in, width_in: m.width_in, cut_in: m.cut_in, crease_in: m.crease_in, perf_in: m.perf_in, rule_in: m.rule_in, ...base, per_display: 1, piece: null, label: null },
      ],
    };
  }
  const sp = splitDieline(text);
  if (!sp.ok) return sp;
  if (sp.pieces.length > BUYER_DIELINE_MAX_PARTS) {
    return {
      ok: false,
      error: "too_many_parts",
      message: `That file has ${sp.pieces.length} separate parts. Online quotes take up to ${BUYER_DIELINE_MAX_PARTS}; send it to the shop and they'll quote it.`,
    };
  }
  const parts = sp.pieces.map((pc) => {
    const want = asked.find((x) => Number(x?.piece) === pc.piece) ?? null;
    const pd = Number(want?.per_display);
    const label = typeof want?.label === "string" ? want.label.trim().slice(0, 60) : "";
    return {
      length_in: pc.length_in,
      width_in: pc.width_in,
      cut_in: pc.cut_in,
      crease_in: pc.crease_in,
      perf_in: pc.perf_in,
      rule_in: pc.rule_in,
      ...base,
      per_display: Number.isInteger(pd) && pd >= 1 && pd <= 10000 ? pd : 1,
      piece: pc.piece,
      label: label || `Part ${pc.piece}`,
    };
  });
  return { ok: true, display: true, units: a.units, warnings: a.warnings, parts };
}
