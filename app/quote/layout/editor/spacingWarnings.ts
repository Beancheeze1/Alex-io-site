// app/quote/layout/editor/spacingWarnings.ts
//
// Client-side early-warning check for cavity-to-cavity spacing, mirroring
// alex-io-step-service's own validate_layout() MIN_WALL_IN guard (0.125in)
// so a rep sees the same problem in the editor that would otherwise only
// surface much later as an opaque STEP export failure.
//
// Investigated on quote Q-AI-20260803-104756: two STL-extracted cavities on
// the same layer came out ~0.087in apart -- confirmed (by re-running the
// actual STL boundary extraction against the source file) to be a genuine
// feature of that customer's part, not an artifact of the extraction
// pipeline. There's nothing to "fix" in that geometry -- this is a
// heuristic warning so it's caught here, at the point the layout is being
// worked on, instead of only at STEP-export time.
//
// SAFE module -- no React imports, pure functions only.

import type { Cavity } from "./layoutTypes";

export const MIN_WALL_IN = 0.125;

type Pt = { x: number; y: number };
type Footprint = { type: "circle"; cx: number; cy: number; r: number } | { type: "poly"; pts: Pt[] };

function normalizePolyPointsIn(points: Pt[], lengthIn: number, widthIn: number): Pt[] {
  const out: Pt[] = [];
  let last: Pt | null = null;
  for (const p of points) {
    const xn = Math.max(0, Math.min(1, Number(p.x)));
    const yn = Math.max(0, Math.min(1, Number(p.y)));
    if (!Number.isFinite(xn) || !Number.isFinite(yn)) continue;
    const x = xn * lengthIn;
    const y = (1 - yn) * widthIn;
    if (!last || last.x !== x || last.y !== y) {
      out.push({ x, y });
      last = { x, y };
    }
  }
  return out;
}

// Mirrors alex-io-step-service's _cavity_footprint_mm, in inches instead of mm.
function cavityFootprintIn(cav: Cavity, blockLengthIn: number, blockWidthIn: number): Footprint | null {
  const shape = (cav.shape || "rect").toLowerCase();

  if (shape === "circle") {
    const diaIn = (cav as any).diameterIn || Math.min(cav.lengthIn, cav.widthIn);
    const r = diaIn / 2;
    let xLeft = cav.x * blockLengthIn;
    let yTopCad = blockWidthIn * (1 - cav.y) - 2 * r;
    xLeft = Math.max(0, Math.min(blockLengthIn - 2 * r, xLeft));
    yTopCad = Math.max(0, Math.min(blockWidthIn - 2 * r, yTopCad));
    return { type: "circle", cx: xLeft + r, cy: yTopCad + r, r };
  }

  if (shape === "poly" && cav.points && cav.points.length >= 3) {
    const pts = normalizePolyPointsIn(cav.points, blockLengthIn, blockWidthIn);
    if (pts.length >= 3) return { type: "poly", pts };
  }

  const cavL = cav.lengthIn;
  const cavW = cav.widthIn;
  if (!(cavL > 0) || !(cavW > 0)) return null;

  let xLeft = cav.x * blockLengthIn;
  let yTopCad = blockWidthIn * (1 - cav.y) - cavW;
  xLeft = Math.max(0, Math.min(blockLengthIn - cavL, xLeft));
  yTopCad = Math.max(0, Math.min(blockWidthIn - cavW, yTopCad));

  return {
    type: "poly",
    pts: [
      { x: xLeft, y: yTopCad },
      { x: xLeft + cavL, y: yTopCad },
      { x: xLeft + cavL, y: yTopCad + cavW },
      { x: xLeft, y: yTopCad + cavW },
    ],
  };
}

function polyEdges(pts: Pt[]): Array<[Pt, Pt]> {
  const p = pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y
    ? pts.slice(0, -1)
    : pts;
  const n = p.length;
  if (n < 2) return [];
  return p.map((pt, i) => [pt, p[(i + 1) % n]] as [Pt, Pt]);
}

function pointToSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-15) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segSegDist(p1: Pt, p2: Pt, q1: Pt, q2: Pt): number {
  const ccw = (a: Pt, b: Pt, c: Pt) => (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  const d1 = ccw(q1, q2, p1);
  const d2 = ccw(q1, q2, p2);
  const d3 = ccw(p1, p2, q1);
  const d4 = ccw(p1, p2, q2);
  if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 && d1 !== 0 && d2 !== 0) return 0;
  return Math.min(
    pointToSegDist(p1, q1, q2),
    pointToSegDist(p2, q1, q2),
    pointToSegDist(q1, p1, p2),
    pointToSegDist(q2, p1, p2),
  );
}

function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const hit = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-18) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function pointInFootprint(pt: Pt, fp: Footprint): boolean {
  if (fp.type === "circle") {
    const dx = pt.x - fp.cx;
    const dy = pt.y - fp.cy;
    return dx * dx + dy * dy <= fp.r * fp.r + 1e-9;
  }
  return pointInPoly(pt, fp.pts);
}

function footprintFullyInside(inner: Footprint, outer: Footprint): boolean {
  if (inner.type === "poly") return inner.pts.every((p) => pointInFootprint(p, outer));
  const samples: Pt[] = [{ x: inner.cx, y: inner.cy }];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    samples.push({ x: inner.cx + inner.r * Math.cos(a), y: inner.cy + inner.r * Math.sin(a) });
  }
  return samples.every((p) => pointInFootprint(p, outer));
}

function minGapIn(a: Footprint, b: Footprint): number {
  if (a.type === "circle" && b.type === "circle") {
    return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r;
  }
  if (a.type === "circle" || b.type === "circle") {
    const [circle, poly] = a.type === "circle" ? [a, b as Extract<Footprint, { type: "poly" }>] : [b as any, a as Extract<Footprint, { type: "poly" }>];
    const edges = polyEdges(poly.pts);
    if (!edges.length) return Infinity;
    const best = Math.min(...edges.map(([p1, p2]) => pointToSegDist({ x: circle.cx, y: circle.cy }, p1, p2)));
    return pointInPoly({ x: circle.cx, y: circle.cy }, poly.pts) ? -best - circle.r : best - circle.r;
  }
  const edgesA = polyEdges((a as Extract<Footprint, { type: "poly" }>).pts);
  const edgesB = polyEdges((b as Extract<Footprint, { type: "poly" }>).pts);
  if (!edgesA.length || !edgesB.length) return Infinity;
  let best = Infinity;
  for (const [a1, a2] of edgesA) {
    for (const [b1, b2] of edgesB) {
      const d = segSegDist(a1, a2, b1, b2);
      if (d < best) best = d;
    }
  }
  return best;
}

export type TightWallWarning = {
  cavityIdA: string;
  cavityLabelA: string;
  cavityIdB: string;
  cavityLabelB: string;
  gapIn: number;
};

export type NearestGapInfo = {
  gapIn: number;
  label: string; // the other cavity's label, or "block edge"
  isBlockEdge: boolean;
};

// Perpendicular distance from a footprint to the block's own 4 edges. Simpler
// than segSegDist since these "edges" are effectively infinite axis-aligned
// lines (x=0, x=blockLengthIn, y=0, y=blockWidthIn) from the footprint's
// perspective -- the footprint is always on one side of each.
function distanceToBlockEdges(fp: Footprint, blockLengthIn: number, blockWidthIn: number): number {
  if (fp.type === "circle") {
    return Math.min(
      fp.cx - fp.r,
      blockLengthIn - (fp.cx + fp.r),
      fp.cy - fp.r,
      blockWidthIn - (fp.cy + fp.r),
    );
  }
  let best = Infinity;
  for (const p of fp.pts) {
    best = Math.min(best, p.x, blockLengthIn - p.x, p.y, blockWidthIn - p.y);
  }
  return best;
}

/**
 * Live "gap to nearest thing" readout for one cavity (the one currently
 * being dragged, or selected) -- distinct from findTightCavityWalls, which
 * only reports pairs already BELOW the warning threshold. This always
 * returns the single nearest distance, whether that's another cavity's
 * real (polygon/circle-accurate) footprint or the block's own edge, so the
 * UI can show a live number while dragging rather than only a pass/fail
 * warning after the fact.
 */
export function nearestGapForCavity(
  candidate: Cavity,
  others: Cavity[],
  blockLengthIn: number,
  blockWidthIn: number,
): NearestGapInfo | null {
  const fp = cavityFootprintIn(candidate, blockLengthIn, blockWidthIn);
  if (!fp) return null;

  let best: NearestGapInfo = {
    gapIn: distanceToBlockEdges(fp, blockLengthIn, blockWidthIn),
    label: "block edge",
    isBlockEdge: true,
  };

  for (const other of others) {
    if (other.id === candidate.id) continue;
    const otherFp = cavityFootprintIn(other, blockLengthIn, blockWidthIn);
    if (!otherFp) continue;
    // Nested (e.g. a stepped pocket) is a legitimate, intentional layout --
    // same exemption findTightCavityWalls already applies.
    if (footprintFullyInside(fp, otherFp) || footprintFullyInside(otherFp, fp)) continue;

    const gap = minGapIn(fp, otherFp);
    if (gap < best.gapIn) {
      best = { gapIn: gap, label: other.label, isBlockEdge: false };
    }
  }

  return best;
}

/**
 * Returns every pair of cavities on this layer whose footprints are closer
 * than MIN_WALL_IN -- the same heuristic alex-io-step-service's
 * validate_layout enforces server-side, so a layout that would pass here
 * should also pass STEP export (and vice versa). Pairs where one footprint
 * is fully nested inside the other (a legitimate "stepped pocket") are
 * exempt, matching the server-side guard exactly.
 */
export function findTightCavityWalls(
  cavities: Cavity[],
  blockLengthIn: number,
  blockWidthIn: number,
): TightWallWarning[] {
  if (!Array.isArray(cavities) || cavities.length < 2) return [];
  if (!(blockLengthIn > 0) || !(blockWidthIn > 0)) return [];

  const footprints = cavities.map((c) => cavityFootprintIn(c, blockLengthIn, blockWidthIn));

  const warnings: TightWallWarning[] = [];
  for (let i = 0; i < cavities.length; i++) {
    const fpA = footprints[i];
    if (!fpA) continue;
    for (let j = i + 1; j < cavities.length; j++) {
      const fpB = footprints[j];
      if (!fpB) continue;

      if (footprintFullyInside(fpA, fpB) || footprintFullyInside(fpB, fpA)) continue;

      const gapIn = minGapIn(fpA, fpB);
      if (gapIn < MIN_WALL_IN) {
        warnings.push({
          cavityIdA: cavities[i].id,
          cavityLabelA: cavities[i].label,
          cavityIdB: cavities[j].id,
          cavityLabelB: cavities[j].label,
          gapIn,
        });
      }
    }
  }
  return warnings;
}
