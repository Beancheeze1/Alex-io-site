// lib/box-dieline.ts
//
// Step 33: flat blank die lines for the slotted styles (RSC, HSC, FOL), from
// inside dims and the shop's corrugated settings (pure: no DB, safe in the
// browser). The sizes follow lib/corrugated-blank.ts exactly, so the drawing
// matches the blank the box was priced on:
//   panels      L + a, W + a, L + a, W + a + last-panel adj   (a = panel allowance)
//   joint       glue / stitch tab on the left (none when taped)
//   body        D + d, score to score                          (d = depth allowance)
//   flaps       RSC / HSC: s x W + f    FOL: W + f            (s = flap %, f = flap allowance)
//   HSC         bottom flaps only; the top edge is a straight cut
//   slots       centered on the panel scores, edge to flap score; half a slot
//               is trimmed off the flaps at the joint and the free end
//   slot width  caliper + 1/16, rounded up to 1/16, at least 1/8
// Edge trim and rounding aren't drawn: they're in the ordered blank size.
// Y runs up the blank (bottom flaps at y = 0), X along it (joint at x = 0);
// the flutes run across the blank (parallel to the panel scores).

import { computeStyleBlank, formatInches, type FluteSpec, type LayoutSettings } from "./corrugated-blank";

export type SlottedStyle = "rsc" | "hsc" | "fol";

export const SLOTTED_STYLES: readonly SlottedStyle[] = ["rsc", "hsc", "fol"];

export function isSlottedStyle(v: unknown): v is SlottedStyle {
  return v === "rsc" || v === "hsc" || v === "fol";
}

export type Seg = { x1: number; y1: number; x2: number; y2: number };

export type Dieline = {
  style: SlottedStyle;
  inside: { L: number; W: number; D: number };
  flute: string;
  caliper_in: number;
  joint: "glued" | "stitched" | "taped";
  joint_in: number; // tab width, 0 when taped
  panels_in: number[]; // 4 panels, joint side first
  body_in: number; // score to score
  flap_in: number; // each flap (bottom, and top unless HSC)
  slot_in: number;
  drawn: { length_in: number; width_in: number }; // what the lines cover
  blank: { length_in: number; width_in: number }; // ordered blank: + edge trim, rounded
  cut: Seg[];
  score: Seg[];
  rule: { cut_in: number; score_in: number };
};

// 1e-6: keeps 1/32 and 1/64 exact
const rd = (n: number) => Math.round(n * 1e6) / 1e6;

/** Caliper + 1/16, rounded up to 1/16, at least 1/8. */
export function slotWidthIn(caliperIn: number): number {
  const c = Number(caliperIn);
  const raw = (Number.isFinite(c) && c > 0 ? c : 0) + 0.0625;
  return Math.max(0.125, Math.ceil(raw / 0.0625 - 1e-9) * 0.0625);
}

function segsFromPath(pts: { x: number; y: number }[], closed: boolean): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) continue;
    out.push({ x1: rd(a.x), y1: rd(a.y), x2: rd(b.x), y2: rd(b.y) });
  }
  if (closed && pts.length > 2) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) out.push({ x1: rd(a.x), y1: rd(a.y), x2: rd(b.x), y2: rd(b.y) });
  }
  return out;
}

const segLen = (s: Seg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/**
 * The die lines for an RSC / HSC / FOL from inside dims (inches). Null when a
 * dimension isn't a positive number or the flaps would be narrower than a slot.
 */
export function slottedDieline(
  style: SlottedStyle,
  dims: { L: number; W: number; D: number },
  flute: FluteSpec,
  layout: LayoutSettings,
): Dieline | null {
  const L = Number(dims.L);
  const W = Number(dims.W);
  const D = Number(dims.D);
  if (![L, W, D].every((n) => Number.isFinite(n) && n > 0)) return null;

  const a = Number(flute.panel_allow_in) || 0;
  const adj = Number(flute.last_panel_adj_in) || 0;
  const d = Number(flute.depth_allow_in) || 0;
  const f = Number(flute.flap_allow_in) || 0;
  const s = (Number(layout.flap_pct) || 50) / 100;
  const taped = layout.joint_type === "taped";
  const j = taped ? 0 : Math.max(0, Number(flute.glue_joint_in) || 0);
  const sw = slotWidthIn(flute.caliper_in);

  const panels = [L + a, W + a, L + a, W + a + adj];
  if (panels.some((p) => !(p > sw * 2))) return null;
  const h = D + d;
  const F = style === "fol" ? W + f : s * W + f;
  if (!(F > 0) || !(h > 0)) return null;
  const topFlaps = style !== "hsc";

  // panel score positions: X[0] = joint score (or the free edge when taped) .. X[4] = free end
  const X = [j];
  for (const p of panels) X.push(X[X.length - 1] + p);
  const half = sw / 2;
  const yB = F; // bottom flap score
  const yT = F + h; // top flap score (or the top edge on an HSC)
  const top = topFlaps ? yT + F : yT;

  const pts: { x: number; y: number }[] = [];
  // bottom edge, joint side to free end, with a slot at each inner score
  pts.push({ x: X[0], y: yB }, { x: X[0] + half, y: yB }, { x: X[0] + half, y: 0 });
  for (let i = 1; i <= 3; i++) {
    pts.push({ x: X[i] - half, y: 0 }, { x: X[i] - half, y: yB }, { x: X[i] + half, y: yB }, { x: X[i] + half, y: 0 });
  }
  pts.push({ x: X[4] - half, y: 0 }, { x: X[4] - half, y: yB }, { x: X[4], y: yB }, { x: X[4], y: yT });
  if (topFlaps) {
    pts.push({ x: X[4] - half, y: yT }, { x: X[4] - half, y: top });
    for (let i = 3; i >= 1; i--) {
      pts.push({ x: X[i] + half, y: top }, { x: X[i] + half, y: yT }, { x: X[i] - half, y: yT }, { x: X[i] - half, y: top });
    }
    pts.push({ x: X[0] + half, y: top }, { x: X[0] + half, y: yT }, { x: X[0], y: yT });
  } else {
    pts.push({ x: X[0], y: yT });
  }
  if (j > 0) {
    // tapered tab, 45 degrees, never more than a quarter of the body
    const taper = Math.min(j, h / 4);
    pts.push({ x: 0, y: yT - taper }, { x: 0, y: yB + taper });
  }
  const cut = segsFromPath(pts, true);

  const score: Seg[] = [];
  const flapScores = topFlaps ? [yB, yT] : [yB];
  for (const y of flapScores) {
    for (let i = 0; i < 4; i++) {
      const x1 = X[i] + half;
      const x2 = X[i + 1] - half;
      score.push({ x1: rd(x1), y1: rd(y), x2: rd(x2), y2: rd(y) });
    }
  }
  const vertical = j > 0 ? [X[0], X[1], X[2], X[3]] : [X[1], X[2], X[3]];
  for (const x of vertical) score.push({ x1: rd(x), y1: rd(yB), x2: rd(x), y2: rd(yT) });

  const blank = computeStyleBlank(style, { L, W, D }, flute, { ...layout, waste_pct: 0 });

  return {
    style,
    inside: { L, W, D },
    flute: flute.flute,
    caliper_in: Number(flute.caliper_in) || 0,
    joint: layout.joint_type,
    joint_in: rd(j),
    panels_in: panels.map(rd),
    body_in: rd(h),
    flap_in: rd(F),
    slot_in: sw,
    drawn: { length_in: rd(X[4]), width_in: rd(top) },
    blank: { length_in: blank.length_in, width_in: blank.width_in },
    cut,
    score,
    rule: {
      cut_in: Math.round(cut.reduce((n, sg) => n + segLen(sg), 0) * 100) / 100,
      score_in: Math.round(score.reduce((n, sg) => n + segLen(sg), 0) * 100) / 100,
    },
  };
}

const STYLE_NAME: Record<SlottedStyle, string> = { rsc: "RSC", hsc: "HSC", fol: "FOL" };

/** Plain-ASCII DXF text (R12 writes only ASCII safely). */
function dxfText(s: string): string {
  return String(s ?? "")
    .replace(/[×]/g, "x")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 200);
}

/**
 * R12 ASCII DXF, inches: CUT (white/black) and CREASE (red) lines, NOTES text
 * below the blank. `notes` lines are printed under the standard callouts.
 */
export function dielineDxf(dl: Dieline, notes: string[] = []): string {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(6) : "0.000000");
  const out: string[] = [];
  const push = (...v: (string | number)[]) => {
    for (const x of v) out.push(String(x));
  };

  push("0", "SECTION", "2", "HEADER");
  push("9", "$ACADVER", "1", "AC1009");
  push("9", "$INSUNITS", "70", "1");
  push("9", "$EXTMIN", "10", fmt(0), "20", fmt(-6), "30", "0.0");
  push("9", "$EXTMAX", "10", fmt(dl.drawn.length_in), "20", fmt(dl.drawn.width_in), "30", "0.0");
  push("0", "ENDSEC");

  push("0", "SECTION", "2", "TABLES");
  push("0", "TABLE", "2", "LTYPE", "70", "1");
  push("0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0");
  push("0", "ENDTAB");
  push("0", "TABLE", "2", "LAYER", "70", "3");
  for (const [name, color] of [
    ["CUT", 7],
    ["CREASE", 1],
    ["NOTES", 3],
  ] as const) {
    push("0", "LAYER", "2", name, "70", "0", "62", color, "6", "CONTINUOUS");
  }
  push("0", "ENDTAB");
  push("0", "ENDSEC");

  push("0", "SECTION", "2", "BLOCKS", "0", "ENDSEC");

  push("0", "SECTION", "2", "ENTITIES");
  const line = (layer: string, sg: Seg) =>
    push("0", "LINE", "8", layer, "10", fmt(sg.x1), "20", fmt(sg.y1), "30", "0.0", "11", fmt(sg.x2), "21", fmt(sg.y2), "31", "0.0");
  for (const sg of dl.cut) line("CUT", sg);
  for (const sg of dl.score) line("CREASE", sg);

  const i = (n: number) => `${formatInches(n)}"`;
  const callouts = [
    `${STYLE_NAME[dl.style]} ${i(dl.inside.L)} x ${i(dl.inside.W)} x ${i(dl.inside.D)} inside, ${dl.flute} flute (caliper ${i(dl.caliper_in)})`,
    `Blank ${i(dl.blank.length_in)} x ${i(dl.blank.width_in)} ordered; lines cover ${i(dl.drawn.length_in)} x ${i(dl.drawn.width_in)}`,
    `Panels ${dl.panels_in.map(i).join(" / ")}; body ${i(dl.body_in)}; flaps ${i(dl.flap_in)}; ${dl.joint === "taped" ? "taped joint" : `${dl.joint} joint ${i(dl.joint_in)}`}; slots ${i(dl.slot_in)}`,
    `Flutes run across the blank (parallel to the panel scores). Layers: CUT, CREASE.`,
    ...notes,
  ];
  const th = 0.25;
  callouts.forEach((txt, k) => {
    push("0", "TEXT", "8", "NOTES", "10", fmt(0), "20", fmt(-0.75 - k * th * 1.8), "30", "0.0", "40", fmt(th), "1", dxfText(txt));
  });
  push("0", "ENDSEC");
  push("0", "EOF");
  return out.join("\n") + "\n";
}

/** "Q-A-261015-28461__Line-2__RSC-12x10x8.dxf" */
export function dielineFilename(quoteNo: string, line: number, dl: Pick<Dieline, "style" | "inside">): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const n = (v: number) => String(Number(v.toFixed(4)));
  return `${clean(quoteNo) || "quote"}__Line-${line}__${STYLE_NAME[dl.style]}-${n(dl.inside.L)}x${n(dl.inside.W)}x${n(dl.inside.D)}.dxf`;
}
