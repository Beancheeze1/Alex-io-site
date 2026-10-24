// app/lib/layout/cavity-merge.ts
//
// Step 39U: cavities that touch or overlap are one pocket.
//
//   joinTouchingCavities(cavities, L, W)
//     Layout-level (normalized x / y, top-left origin, inches for sizes).
//     Two rectangular cavities (rect / rounded rect) whose facing edges are
//     within JOIN_GAP_IN of each other (touching, a hair apart, or barely
//     overlapping) are made to overlap by JOIN_OVERLAP_IN: the shallower one
//     is stretched into the deeper one (the later one when equally deep).
//     No paper-thin wall is left between them in the STEP, and the DXF sees
//     one pocket. Cavities that already overlap more than that are left alone.
//
//   mergeCavityOutlines(regions)
//     Drawing-level (inches, y up). Splits every cavity edge where it meets
//     another cavity and keeps only the pieces that are real edges:
//       - "cut":   uncut foam on one side (the merged outer outline)
//       - "depth": cavity on both sides but the floor depth changes (a
//                  deeper pocket inside a shallower one)
//       - "through": (when throughAt is given, i.e. the part's thickness) the
//                  edge of a cut that goes all the way through the part
//     Lines inside a pocket where the depth doesn't change are dropped, and
//     a shared edge is drawn once. Circles and rounded corners stay arcs.
//
// Pure; tested in scripts/test-cavity-merge.ts.

export const JOIN_GAP_IN = 0.03;
export const JOIN_OVERLAP_IN = 0.01;

type Pt = { x: number; y: number };

export type CavityRegion =
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number; depth: number }
  | { kind: "rrect"; x0: number; y0: number; x1: number; y1: number; r: number; depth: number }
  | { kind: "circle"; cx: number; cy: number; r: number; depth: number }
  | { kind: "poly"; pts: Pt[]; depth: number };

export type OutlinePiece =
  | { t: "line"; layer: OutlineLayer; x1: number; y1: number; x2: number; y2: number }
  // arc: counter-clockwise from a0 to a1 (radians); a full circle is 0..2π
  | { t: "arc"; layer: OutlineLayer; cx: number; cy: number; r: number; a0: number; a1: number };

export type OutlineLayer = "cut" | "depth" | "through";

type Prim = { t: "line"; a: Pt; b: Pt } | { t: "arc"; cx: number; cy: number; r: number; a0: number; a1: number };

const TAU = Math.PI * 2;
const E = 1e-9;
const SIDE = 1e-3; // how far to each side of a piece we look for foam / cavity

/* ---------------- layout level: join touching cavities ---------------- */

type AnyCav = Record<string, unknown>;

function shapeOf(c: AnyCav): string {
  if (Array.isArray(c.points) && (c.points as unknown[]).length >= 3) return "poly";
  return String(c.shape ?? c.cavityShape ?? c.cavity_shape ?? c.type ?? "rect").toLowerCase();
}
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Step 39U: stretch the shallower of two touching rectangular cavities so they
 * overlap a little (see the header). Returns new cavity objects (the input is
 * not changed); anything that isn't a rectangle is passed through as is.
 */
export function joinTouchingCavities<T extends AnyCav>(cavities: T[], L: number, W: number, layerThicknessIn?: number): T[] {
  const out = cavities.map((c) => ({ ...c })) as T[];
  if (!(L > 0 && W > 0)) return out;
  type B = { i: number; x0: number; y0: number; x1: number; y1: number; depth: number };
  const boxes: B[] = [];
  out.forEach((c, i) => {
    const s = shapeOf(c);
    if (s === "circle" || s === "round" || s === "poly") return;
    const len = num(c.lengthIn ?? c.length_in);
    const wid = num(c.widthIn ?? c.width_in);
    const x = num(c.x);
    const y = num(c.y);
    if (!(len > 0 && wid > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const d = num(c.depthIn ?? c.depth_in);
    boxes.push({ i, x0: x * L, y0: y * W, x1: x * L + len, y1: y * W + wid, depth: d > 0 ? d : layerThicknessIn ?? 1e6 });
  });
  for (let p = 0; p < boxes.length; p++) {
    for (let q = p + 1; q < boxes.length; q++) {
      const a = boxes[p];
      const b = boxes[q];
      // the one that moves: shallower, or the later one when equally deep
      const [mv, st] = a.depth < b.depth - E ? [a, b] : [b, a];
      const spanY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const spanX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (spanY > JOIN_OVERLAP_IN) {
        // side by side (left / right)
        if (mv.x1 <= st.x0 + JOIN_OVERLAP_IN && st.x0 - mv.x1 <= JOIN_GAP_IN && mv.x0 < st.x0) mv.x1 = st.x0 + JOIN_OVERLAP_IN;
        else if (mv.x0 >= st.x1 - JOIN_OVERLAP_IN && mv.x0 - st.x1 <= JOIN_GAP_IN && mv.x1 > st.x1) mv.x0 = st.x1 - JOIN_OVERLAP_IN;
      }
      if (spanX > JOIN_OVERLAP_IN) {
        // one above the other
        if (mv.y1 <= st.y0 + JOIN_OVERLAP_IN && st.y0 - mv.y1 <= JOIN_GAP_IN && mv.y0 < st.y0) mv.y1 = st.y0 + JOIN_OVERLAP_IN;
        else if (mv.y0 >= st.y1 - JOIN_OVERLAP_IN && mv.y0 - st.y1 <= JOIN_GAP_IN && mv.y1 > st.y1) mv.y0 = st.y1 - JOIN_OVERLAP_IN;
      }
    }
  }
  for (const bx of boxes) {
    const c = out[bx.i] as AnyCav;
    const len = Math.round((bx.x1 - bx.x0) * 1e6) / 1e6;
    const wid = Math.round((bx.y1 - bx.y0) * 1e6) / 1e6;
    const changed =
      Math.abs(bx.x0 / L - num(c.x)) > 1e-9 || Math.abs(bx.y0 / W - num(c.y)) > 1e-9 || Math.abs(len - num(c.lengthIn ?? c.length_in)) > 1e-9 || Math.abs(wid - num(c.widthIn ?? c.width_in)) > 1e-9;
    if (!changed) continue;
    c.x = bx.x0 / L;
    c.y = bx.y0 / W;
    if ("lengthIn" in c || !("length_in" in c)) c.lengthIn = len;
    else c.length_in = len;
    if ("widthIn" in c || !("width_in" in c)) c.widthIn = wid;
    else c.width_in = wid;
  }
  return out;
}

/** Step 39U: a whole layout with every layer's touching cavities joined (a copy). */
export function joinLayoutCavities<T>(layout: T): T {
  if (!layout || typeof layout !== "object") return layout;
  const lay = layout as AnyCav;
  const block = (lay.block && typeof lay.block === "object" ? lay.block : {}) as AnyCav;
  const L = num(block.lengthIn ?? block.length_in);
  const W = num(block.widthIn ?? block.width_in) || L;
  if (!(L > 0 && W > 0)) return layout;
  const fix = (layer: unknown) => {
    if (!layer || typeof layer !== "object") return layer;
    const ly = layer as AnyCav;
    if (!Array.isArray(ly.cavities)) return layer;
    const t = num(ly.thicknessIn ?? ly.thickness_in);
    return { ...ly, cavities: joinTouchingCavities(ly.cavities as AnyCav[], L, W, t > 0 ? t : undefined) };
  };
  const next: AnyCav = { ...lay };
  for (const key of ["stack", "layers", "foamLayers"]) {
    if (Array.isArray(lay[key])) next[key] = (lay[key] as unknown[]).map(fix);
  }
  if (Array.isArray(lay.cavities)) {
    const t = num(block.thicknessIn ?? block.thickness_in);
    next.cavities = joinTouchingCavities(lay.cavities as AnyCav[], L, W, t > 0 ? t : undefined);
  }
  return next as T;
}

/* ---------------- drawing level: merged outline ---------------- */

function inside(r: CavityRegion, p: Pt): boolean {
  switch (r.kind) {
    case "rect":
      return p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
    case "rrect": {
      if (!(p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1)) return false;
      const rr = Math.min(r.r, (r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2);
      const cx = p.x < r.x0 + rr ? r.x0 + rr : p.x > r.x1 - rr ? r.x1 - rr : null;
      const cy = p.y < r.y0 + rr ? r.y0 + rr : p.y > r.y1 - rr ? r.y1 - rr : null;
      if (cx == null || cy == null) return true;
      return Math.hypot(p.x - cx, p.y - cy) < rr;
    }
    case "circle":
      return Math.hypot(p.x - r.cx, p.y - r.cy) < r.r;
    case "poly": {
      let c = false;
      const pts = r.pts;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    }
  }
}

function primsOf(r: CavityRegion): Prim[] {
  const L = (ax: number, ay: number, bx: number, by: number): Prim => ({ t: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });
  switch (r.kind) {
    case "rect":
      return [L(r.x0, r.y0, r.x1, r.y0), L(r.x1, r.y0, r.x1, r.y1), L(r.x1, r.y1, r.x0, r.y1), L(r.x0, r.y1, r.x0, r.y0)];
    case "rrect": {
      const rr = Math.max(0, Math.min(r.r, (r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2));
      if (rr < 1e-6) return primsOf({ kind: "rect", x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, depth: r.depth });
      const out: Prim[] = [];
      const pushLine = (ax: number, ay: number, bx: number, by: number) => {
        if (Math.hypot(bx - ax, by - ay) > 1e-6) out.push(L(ax, ay, bx, by));
      };
      pushLine(r.x0 + rr, r.y0, r.x1 - rr, r.y0);
      out.push({ t: "arc", cx: r.x1 - rr, cy: r.y0 + rr, r: rr, a0: 1.5 * Math.PI, a1: TAU });
      pushLine(r.x1, r.y0 + rr, r.x1, r.y1 - rr);
      out.push({ t: "arc", cx: r.x1 - rr, cy: r.y1 - rr, r: rr, a0: 0, a1: 0.5 * Math.PI });
      pushLine(r.x1 - rr, r.y1, r.x0 + rr, r.y1);
      out.push({ t: "arc", cx: r.x0 + rr, cy: r.y1 - rr, r: rr, a0: 0.5 * Math.PI, a1: Math.PI });
      pushLine(r.x0, r.y1 - rr, r.x0, r.y0 + rr);
      out.push({ t: "arc", cx: r.x0 + rr, cy: r.y0 + rr, r: rr, a0: Math.PI, a1: 1.5 * Math.PI });
      return out;
    }
    case "circle":
      return [{ t: "arc", cx: r.cx, cy: r.cy, r: r.r, a0: 0, a1: TAU }];
    case "poly":
      return r.pts.map((p, i) => {
        const q = r.pts[(i + 1) % r.pts.length];
        return L(p.x, p.y, q.x, q.y);
      });
  }
}

const angNorm = (a: number) => ((a % TAU) + TAU) % TAU;
/** Where angle a sits on an arc as a 0..1 parameter, or null when it's off the arc. */
function arcParam(p: Extract<Prim, { t: "arc" }>, a: number): number | null {
  const span = p.a1 - p.a0;
  let d = angNorm(a - p.a0);
  if (d > span + 1e-9) {
    if (Math.abs(d - TAU) < 1e-9) d = 0;
    else return null;
  }
  return Math.min(1, Math.max(0, d / span));
}
function pointAt(p: Prim, t: number): Pt {
  if (p.t === "line") return { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t };
  const a = p.a0 + (p.a1 - p.a0) * t;
  return { x: p.cx + p.r * Math.cos(a), y: p.cy + p.r * Math.sin(a) };
}
function lineParam(p: Extract<Prim, { t: "line" }>, q: Pt): number | null {
  const dx = p.b.x - p.a.x;
  const dy = p.b.y - p.a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < E) return null;
  const t = ((q.x - p.a.x) * dx + (q.y - p.a.y) * dy) / len2;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  const px = p.a.x + dx * t;
  const py = p.a.y + dy * t;
  return Math.hypot(px - q.x, py - q.y) < 1e-6 ? Math.min(1, Math.max(0, t)) : null;
}

/** Points where q's path crosses or touches p (as p's 0..1 parameters). */
function splitParams(p: Prim, q: Prim): number[] {
  const out: number[] = [];
  const onP = (pt: Pt) => {
    const t = p.t === "line" ? lineParam(p, pt) : (() => {
      if (Math.abs(Math.hypot(pt.x - p.cx, pt.y - p.cy) - p.r) > 1e-6) return null;
      return arcParam(p, Math.atan2(pt.y - p.cy, pt.x - p.cx));
    })();
    if (t != null) out.push(t);
  };
  const onQ = (pt: Pt) => {
    if (q.t === "line") return lineParam(q, pt) != null;
    if (Math.abs(Math.hypot(pt.x - q.cx, pt.y - q.cy) - q.r) > 1e-6) return false;
    return arcParam(q, Math.atan2(pt.y - q.cy, pt.x - q.cx)) != null;
  };
  // q's end points lying on p (T-junctions, collinear / concentric overlaps)
  if (q.t === "line") {
    onP(q.a);
    onP(q.b);
  } else if (q.a1 - q.a0 < TAU - 1e-9) {
    onP(pointAt(q, 0));
    onP(pointAt(q, 1));
  }
  // proper crossings
  const circleOf = (x: Extract<Prim, { t: "arc" }>) => ({ cx: x.cx, cy: x.cy, r: x.r });
  if (p.t === "line" && q.t === "line") {
    const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
    const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) > E) {
      const t = ((q.a.x - p.a.x) * s.y - (q.a.y - p.a.y) * s.x) / den;
      const u = ((q.a.x - p.a.x) * r.y - (q.a.y - p.a.y) * r.x) / den;
      if (t > -1e-9 && t < 1 + 1e-9 && u > -1e-9 && u < 1 + 1e-9) out.push(Math.min(1, Math.max(0, t)));
    }
  } else {
    const pts: Pt[] = [];
    if (p.t === "line" || q.t === "line") {
      const ln = (p.t === "line" ? p : q) as Extract<Prim, { t: "line" }>;
      const c = circleOf((p.t === "arc" ? p : q) as Extract<Prim, { t: "arc" }>);
      const dx = ln.b.x - ln.a.x;
      const dy = ln.b.y - ln.a.y;
      const fx = ln.a.x - c.cx;
      const fy = ln.a.y - c.cy;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - c.r * c.r;
      const disc = B * B - 4 * A * C;
      if (A > E && disc >= -1e-12) {
        const sq = Math.sqrt(Math.max(0, disc));
        for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) pts.push({ x: ln.a.x + dx * t, y: ln.a.y + dy * t });
      }
    } else {
      const a = circleOf(p as Extract<Prim, { t: "arc" }>);
      const b = circleOf(q);
      const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      if (d > E && d <= a.r + b.r + 1e-9 && d >= Math.abs(a.r - b.r) - 1e-9) {
        const aa = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, a.r * a.r - aa * aa));
        const mx = a.cx + (aa * (b.cx - a.cx)) / d;
        const my = a.cy + (aa * (b.cy - a.cy)) / d;
        pts.push({ x: mx + (h * (b.cy - a.cy)) / d, y: my - (h * (b.cx - a.cx)) / d });
        pts.push({ x: mx - (h * (b.cy - a.cy)) / d, y: my + (h * (b.cx - a.cx)) / d });
      }
    }
    for (const pt of pts) if (onQ(pt)) onP(pt);
  }
  return out;
}

function depthAt(regions: CavityRegion[], p: Pt): number {
  let d = 0;
  for (const r of regions) if (inside(r, p)) d = Math.max(d, r.depth);
  return d;
}

/**
 * Step 39U: the visible lines of a layer's cavities (see the header). Depths
 * only need to compare: pass the same depth for every cavity to get just the
 * merged outline (a sheet cut through by all of them).
 */
export function mergeCavityOutlines(regions: CavityRegion[], opts: { throughAt?: number | null } = {}): OutlinePiece[] {
  const throughAt = opts.throughAt != null && opts.throughAt > 0 ? opts.throughAt : null;
  const prims = regions.map(primsOf);
  const out: OutlinePiece[] = [];
  const seen = new Set<string>();
  const k = (n: number) => Math.round(n * 1e4) / 1e4;

  regions.forEach((_, ri) => {
    for (const p of prims[ri]) {
      const ts = [0, 1];
      regions.forEach((__, rj) => {
        if (rj === ri) return;
        for (const q of prims[rj]) ts.push(...splitParams(p, q));
      });
      const sorted = Array.from(new Set(ts.map((t) => Math.round(t * 1e9) / 1e9))).sort((a, b) => a - b);
      let run: { t0: number; t1: number; layer: OutlineLayer } | null = null;
      const flush = () => {
        if (!run) return;
        const piece: OutlinePiece =
          p.t === "line"
            ? (() => {
                const a = pointAt(p, run.t0);
                const b = pointAt(p, run.t1);
                return { t: "line" as const, layer: run.layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
              })()
            : { t: "arc", layer: run.layer, cx: p.cx, cy: p.cy, r: p.r, a0: p.a0 + (p.a1 - p.a0) * run.t0, a1: p.a0 + (p.a1 - p.a0) * run.t1 };
        const key =
          piece.t === "line"
            ? [[k(piece.x1), k(piece.y1)], [k(piece.x2), k(piece.y2)]].sort().join("|")
            : `a${k(piece.cx)},${k(piece.cy)},${k(piece.r)},${k(angNorm(piece.a0))},${k(piece.a1 - piece.a0)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(piece);
        }
        run = null;
      };
      for (let i = 0; i < sorted.length - 1; i++) {
        const t0 = sorted[i];
        const t1 = sorted[i + 1];
        const a = pointAt(p, t0);
        const b = pointAt(p, t1);
        const long = p.t === "line" ? Math.hypot(b.x - a.x, b.y - a.y) : p.r * (p.a1 - p.a0) * (t1 - t0);
        if (long < 1e-6) continue;
        const tm = (t0 + t1) / 2;
        const m = pointAt(p, tm);
        let nx: number, ny: number;
        if (p.t === "line") {
          const dx = p.b.x - p.a.x;
          const dy = p.b.y - p.a.y;
          const l = Math.hypot(dx, dy);
          nx = -dy / l;
          ny = dx / l;
        } else {
          nx = (m.x - p.cx) / p.r;
          ny = (m.y - p.cy) / p.r;
        }
        const d1 = depthAt(regions, { x: m.x + nx * SIDE, y: m.y + ny * SIDE });
        const d2 = depthAt(regions, { x: m.x - nx * SIDE, y: m.y - ny * SIDE });
        if (Math.abs(d1 - d2) < 1e-6) {
          flush();
          continue;
        }
        const layer: OutlineLayer =
          throughAt != null && Math.max(d1, d2) >= throughAt - 1e-6 ? "through" : Math.min(d1, d2) <= 0 ? "cut" : "depth";
        if (run && run.layer === layer && Math.abs(run.t1 - t0) < 1e-9) run.t1 = t1;
        else {
          flush();
          run = { t0, t1, layer };
        }
      }
      flush();
    }
  });
  return out;
}

/** True when two regions' boxes touch or overlap (only then is merging needed). */
export function regionsInteract(regions: CavityRegion[]): boolean {
  const box = (r: CavityRegion) =>
    r.kind === "circle"
      ? { x0: r.cx - r.r, y0: r.cy - r.r, x1: r.cx + r.r, y1: r.cy + r.r }
      : r.kind === "poly"
        ? {
            x0: Math.min(...r.pts.map((p) => p.x)),
            y0: Math.min(...r.pts.map((p) => p.y)),
            x1: Math.max(...r.pts.map((p) => p.x)),
            y1: Math.max(...r.pts.map((p) => p.y)),
          }
        : { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
  const bs = regions.map(box);
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      if (bs[i].x0 <= bs[j].x1 + 1e-9 && bs[j].x0 <= bs[i].x1 + 1e-9 && bs[i].y0 <= bs[j].y1 + 1e-9 && bs[j].y0 <= bs[i].y1 + 1e-9) return true;
    }
  return false;
}
