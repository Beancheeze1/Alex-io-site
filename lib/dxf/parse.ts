// lib/dxf/parse.ts
//
// Step 37A2: our own DXF reader for the layout editor's "Upload file".
// The outside converter only chained plain LINE shapes, so a real foam
// drawing (lines + arcs, splines) came back as just its circles. This reads
// the DXF here, in process (like STL), and hands the editor the same
// forge_faces.json shape it already seeds from (lib/forgeFacesSeed.ts).
//
//   parseDxf(text)        -> entities as line segments, in inches
//   buildLoops(segments)  -> closed outlines (endpoints joined within a
//                            small gap, so tiny CAD gaps still close)
//   dxfToFaces(text)      -> one FacesJson per insert found in the drawing
//                            (an insert = an outline that is not inside
//                            another one, with everything inside it)
//
// Supported: LINE, ARC, CIRCLE, LWPOLYLINE / POLYLINE (with bulges),
// ELLIPSE, SPLINE, and INSERT (blocks). Text, dimensions and hatches are
// ignored. Units come from $INSUNITS (inches when missing).
// Pure: no DB, no network (tested in scripts/test-dxf.ts).

export type Pt = { x: number; y: number };
export type Seg = { x1: number; y1: number; x2: number; y2: number };

export type FacesLoop = {
  idx: number;
  closed: true;
  area: number; // + for the outline and islands, - for cavities (what the seed expects)
  perimeter: number;
  edges: number;
  points: Pt[];
};

export type DxfFaces = {
  units: "in";
  outerLoopIndex: number;
  loopsCount: number;
  loops: FacesLoop[];
  source: "dxf";
  insert: { index: number; count: number; lengthIn: number; widthIn: number };
  warnings: string[];
};

export type DxfResult = {
  inserts: DxfFaces[];
  warnings: string[];
  stats: { entities: Record<string, number>; segments: number; loops: number; openChains: number; unitsLabel: string };
};

/* ----------------------------- units ----------------------------- */

/** $INSUNITS code -> inches per drawing unit (0 / unknown = inches). */
const UNIT_TO_IN: Record<number, { f: number; label: string }> = {
  0: { f: 1, label: "unitless (read as inches)" },
  1: { f: 1, label: "inches" },
  2: { f: 12, label: "feet" },
  4: { f: 1 / 25.4, label: "mm" },
  5: { f: 1 / 2.54, label: "cm" },
  6: { f: 1000 / 25.4, label: "meters" },
  8: { f: 1e-6, label: "microinches" },
  9: { f: 0.001, label: "mils" },
};

export function unitsFactor(code: number | null): { f: number; label: string } {
  if (code == null || !Number.isFinite(code)) return { f: 1, label: "not set (read as inches)" };
  return UNIT_TO_IN[code] || { f: 1, label: `code ${code} (read as inches)` };
}

/* --------------------------- tokenizer --------------------------- */

type Pair = { code: number; value: string };

export function dxfPairs(text: string): Pair[] {
  const lines = String(text || "").split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) {
      i -= 1; // resync on a stray line
      continue;
    }
    out.push({ code, value: lines[i + 1].trim() });
  }
  return out;
}

type Entity = { type: string; pairs: Pair[]; vertices?: Entity[] };

function num(e: Entity, code: number, dflt = 0): number {
  const p = e.pairs.find((x) => x.code === code);
  const v = p ? parseFloat(p.value) : NaN;
  return Number.isFinite(v) ? v : dflt;
}
function nums(e: Entity, code: number): number[] {
  return e.pairs.filter((x) => x.code === code).map((x) => parseFloat(x.value));
}
function str(e: Entity, code: number): string {
  return e.pairs.find((x) => x.code === code)?.value ?? "";
}

/** Splits a run of pairs (one section / block body) into entities; folds POLYLINE vertices in. */
function toEntities(pairs: Pair[]): Entity[] {
  const raw: Entity[] = [];
  let cur: Entity | null = null;
  for (const p of pairs) {
    if (p.code === 0) {
      cur = { type: p.value.toUpperCase(), pairs: [] };
      raw.push(cur);
    } else if (cur) cur.pairs.push(p);
  }
  const out: Entity[] = [];
  let poly: Entity | null = null;
  for (const e of raw) {
    if (e.type === "POLYLINE") {
      poly = { ...e, vertices: [] };
      out.push(poly);
    } else if (e.type === "VERTEX" && poly) poly.vertices!.push(e);
    else if (e.type === "SEQEND") poly = null;
    else out.push(e);
  }
  return out;
}

type Doc = { insunits: number | null; entities: Entity[]; blocks: Map<string, { base: Pt; entities: Entity[] }> };

export function readDoc(text: string): Doc {
  const pairs = dxfPairs(text);
  let insunits: number | null = null;
  const blocks = new Map<string, { base: Pt; entities: Entity[] }>();
  let entities: Entity[] = [];

  let i = 0;
  while (i < pairs.length) {
    if (pairs[i].code === 0 && pairs[i].value === "SECTION" && pairs[i + 1]?.code === 2) {
      const name = pairs[i + 1].value.toUpperCase();
      let j = i + 2;
      while (j < pairs.length && !(pairs[j].code === 0 && pairs[j].value === "ENDSEC")) j++;
      const body = pairs.slice(i + 2, j);
      if (name === "HEADER") {
        for (let k = 0; k < body.length; k++) {
          if (body[k].code === 9 && body[k].value === "$INSUNITS" && body[k + 1]?.code === 70) {
            insunits = parseInt(body[k + 1].value, 10);
          }
        }
      } else if (name === "ENTITIES") {
        entities = toEntities(body);
      } else if (name === "BLOCKS") {
        let k = 0;
        while (k < body.length) {
          if (body[k].code === 0 && body[k].value === "BLOCK") {
            let m = k + 1;
            while (m < body.length && body[m].code !== 0) m++;
            const head: Entity = { type: "BLOCK", pairs: body.slice(k + 1, m) };
            let end = m;
            while (end < body.length && !(body[end].code === 0 && body[end].value === "ENDBLK")) end++;
            const bname = str(head, 2);
            if (bname) blocks.set(bname, { base: { x: num(head, 10), y: num(head, 20) }, entities: toEntities(body.slice(m, end)) });
            k = end + 1;
          } else k++;
        }
      }
      i = j + 1;
    } else i++;
  }
  return { insunits, entities, blocks };
}

/* ----------------------- geometry to segments ----------------------- */

type Xform = (p: Pt) => Pt;
const ID: Xform = (p) => p;

/** Points along a circular arc (angles in radians, ccw from a0 to a1), chord-limited. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, tolIn: number): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  if (sweep > Math.PI * 2) sweep = Math.PI * 2;
  // segments so the chord sags at most tol, at least 1 per 15 deg, never edges < ~0.06"
  const maxStep = r > tolIn ? 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolIn / r))) : Math.PI / 2;
  const byTol = Math.ceil(sweep / Math.max(maxStep, 1e-6));
  const byAngle = Math.ceil(sweep / (Math.PI / 12));
  const byLen = Math.max(1, Math.floor((sweep * r) / 0.06));
  const n = Math.max(1, Math.min(Math.max(byTol, byAngle), byLen, 720));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Bulge arc between two polyline vertices -> points (excluding the start point). */
function bulgePoints(p0: Pt, p1: Pt, bulge: number, tolIn: number): Pt[] {
  if (!bulge || Math.abs(bulge) < 1e-9) return [p1];
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (chord < 1e-12) return [p1];
  const theta = 4 * Math.atan(bulge); // signed included angle
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  // center lies to the left of p0->p1 for a ccw (positive) bulge < 180 deg
  const ux = -(p1.y - p0.y) / chord;
  const uy = (p1.x - p0.x) / chord;
  const s = (Math.abs(theta) < Math.PI ? 1 : -1) * Math.sign(bulge);
  const cx = mx + ux * d * s;
  const cy = my + uy * d * s;
  const a0 = Math.atan2(p0.y - cy, p0.x - cx);
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  let pts: Pt[];
  if (bulge > 0) pts = arcPoints(cx, cy, r, a0, a1, tolIn);
  else pts = arcPoints(cx, cy, r, a1, a0, tolIn).reverse();
  pts[pts.length - 1] = p1;
  return pts.slice(1);
}

/** Uniform / clamped B-spline evaluation (de Boor), or fit points when no control points. */
export function splinePoints(e: Entity, tolIn: number): Pt[] {
  const degree = Math.max(1, Math.round(num(e, 71, 3)));
  const knots = nums(e, 40).filter(Number.isFinite);
  const cx = nums(e, 10);
  const cy = nums(e, 20);
  const weights = nums(e, 41);
  const ctrl: Pt[] = cx.map((x, i) => ({ x, y: cy[i] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (ctrl.length < 2) {
    const fx = nums(e, 11);
    const fy = nums(e, 21);
    return fx.map((x, i) => ({ x, y: fy[i] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  const n = ctrl.length;
  const p = Math.min(degree, n - 1);
  let U = knots;
  if (U.length !== n + p + 1) {
    // clamped uniform fallback
    U = [];
    for (let i = 0; i <= p; i++) U.push(0);
    for (let i = 1; i < n - p; i++) U.push(i / (n - p));
    for (let i = 0; i <= p; i++) U.push(1);
  }
  const w = weights.length === n ? weights : ctrl.map(() => 1);
  const t0 = U[p];
  const t1 = U[n];
  // sample density: by control polygon length
  let poly = 0;
  for (let i = 1; i < n; i++) poly += Math.hypot(ctrl[i].x - ctrl[i - 1].x, ctrl[i].y - ctrl[i - 1].y);
  const samples = Math.max(8, Math.min(2000, Math.ceil(poly / Math.max(0.03, tolIn * 10)), n * 12));
  const out: Pt[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? t1 : t0 + ((t1 - t0) * s) / samples;
    let k = p;
    while (k < n - 1 && t >= U[k + 1]) k++;
    const d: { x: number; y: number; w: number }[] = [];
    for (let j = 0; j <= p; j++) {
      const c = ctrl[k - p + j];
      const ww = w[k - p + j] || 1;
      d.push({ x: c.x * ww, y: c.y * ww, w: ww });
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = U[i + p - r + 1] - U[i];
        const a = den > 0 ? (t - U[i]) / den : 0;
        d[j] = {
          x: (1 - a) * d[j - 1].x + a * d[j].x,
          y: (1 - a) * d[j - 1].y + a * d[j].y,
          w: (1 - a) * d[j - 1].w + a * d[j].w,
        };
      }
    }
    const q = d[p];
    out.push({ x: q.x / (q.w || 1), y: q.y / (q.w || 1) });
  }
  return out;
}

function pushPath(segs: Seg[], pts: Pt[], xf: Xform) {
  for (let i = 1; i < pts.length; i++) {
    const a = xf(pts[i - 1]);
    const b = xf(pts[i]);
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
}

/** OCS with extrusion (0,0,-1) mirrors X (common in SolidWorks exports). */
function ocs(e: Entity): Xform {
  return num(e, 230, 1) < 0 ? (p) => ({ x: -p.x, y: p.y }) : ID;
}

const IGNORED = new Set([
  "TEXT", "MTEXT", "DIMENSION", "HATCH", "SOLID", "POINT", "LEADER", "MLEADER",
  "ATTRIB", "ATTDEF", "VIEWPORT", "IMAGE", "WIPEOUT", "3DFACE", "TRACE", "XLINE", "RAY",
]);

function entitySegments(
  ents: Entity[],
  doc: Doc,
  xf: Xform,
  tolIn: number,
  counts: Record<string, number>,
  depth: number,
  scaleHint: number,
): Seg[] {
  const segs: Seg[] = [];
  // tolerance in drawing units (scaleHint = inches per unit after xf)
  const tol = tolIn / Math.max(scaleHint, 1e-12);
  for (const e of ents) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (IGNORED.has(e.type)) continue;
    // paper-space entities (title blocks on layouts) are skipped
    if (str(e, 67) === "1") continue;
    switch (e.type) {
      case "LINE":
        pushPath(segs, [{ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }], xf);
        break;
      case "ARC": {
        const o = ocs(e);
        const pts = arcPoints(num(e, 10), num(e, 20), num(e, 40), (num(e, 50) * Math.PI) / 180, (num(e, 51) * Math.PI) / 180, tol);
        pushPath(segs, pts.map(o), xf);
        break;
      }
      case "CIRCLE": {
        const o = ocs(e);
        const pts = arcPoints(num(e, 10), num(e, 20), num(e, 40), 0, Math.PI * 2, tol);
        pts[pts.length - 1] = pts[0];
        pushPath(segs, pts.map(o), xf);
        break;
      }
      case "LWPOLYLINE": {
        const o = ocs(e);
        const closed = (num(e, 70) & 1) === 1;
        // walk pairs in order: each 10 starts a vertex, 42 sets its bulge
        const vs: { p: Pt; b: number }[] = [];
        for (const p of e.pairs) {
          if (p.code === 10) vs.push({ p: { x: parseFloat(p.value), y: 0 }, b: 0 });
          else if (p.code === 20 && vs.length) vs[vs.length - 1].p.y = parseFloat(p.value);
          else if (p.code === 42 && vs.length) vs[vs.length - 1].b = parseFloat(p.value) || 0;
        }
        polySegments(segs, vs, closed, tol, (q) => xf(o(q)));
        break;
      }
      case "POLYLINE": {
        const flags = num(e, 70);
        if (flags & (16 | 64)) break; // 3D meshes / polyface: not a 2D outline
        const o = ocs(e);
        const vs = (e.vertices || [])
          .filter((v) => !(num(v, 70) & 16)) // spline frame control points
          .map((v) => ({ p: { x: num(v, 10), y: num(v, 20) }, b: num(v, 42) }));
        polySegments(segs, vs, (flags & 1) === 1, tol, (q) => xf(o(q)));
        break;
      }
      case "ELLIPSE": {
        const c = { x: num(e, 10), y: num(e, 20) };
        const mx = num(e, 11);
        const my = num(e, 21);
        const ratio = num(e, 40, 1);
        const t0 = num(e, 41, 0);
        let t1 = num(e, 42, Math.PI * 2);
        while (t1 <= t0) t1 += Math.PI * 2;
        const a = Math.hypot(mx, my);
        const rot = Math.atan2(my, mx);
        const n = Math.max(12, Math.min(720, Math.ceil(((t1 - t0) * a) / 0.06)));
        const pts: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const t = t0 + ((t1 - t0) * i) / n;
          const ex = a * Math.cos(t);
          const ey = a * ratio * Math.sin(t);
          pts.push({ x: c.x + ex * Math.cos(rot) - ey * Math.sin(rot), y: c.y + ex * Math.sin(rot) + ey * Math.cos(rot) });
        }
        const o = num(e, 230, 1) < 0 ? (q: Pt) => ({ x: -q.x, y: q.y }) : ID;
        pushPath(segs, pts.map(o), xf);
        break;
      }
      case "SPLINE":
        pushPath(segs, splinePoints(e, tol), xf);
        break;
      case "INSERT": {
        if (depth > 6) break;
        const b = doc.blocks.get(str(e, 2));
        if (!b) break;
        const ip = { x: num(e, 10), y: num(e, 20) };
        const sx = num(e, 41, 1);
        const sy = num(e, 42, 1);
        const rot = (num(e, 50, 0) * Math.PI) / 180;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const ins: Xform = (q) => {
          const x = (q.x - b.base.x) * sx;
          const y = (q.y - b.base.y) * sy;
          return xf({ x: ip.x + x * cos - y * sin, y: ip.y + x * sin + y * cos });
        };
        segs.push(...entitySegments(b.entities, doc, ins, tolIn, counts, depth + 1, scaleHint * Math.max(Math.abs(sx), Math.abs(sy), 1e-9)));
        break;
      }
      default:
        break;
    }
  }
  return segs;
}

function polySegments(segs: Seg[], vs: { p: Pt; b: number }[], closed: boolean, tol: number, xf: Xform) {
  if (vs.length < 2) return;
  const pts: Pt[] = [vs[0].p];
  const last = closed ? vs.length : vs.length - 1;
  for (let i = 0; i < last; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    pts.push(...bulgePoints(a.p, b.p, a.b, tol));
  }
  pushPath(segs, pts, xf);
}

/* ---------------------------- parseDxf ---------------------------- */

export function parseDxf(text: string, opts: { tolIn?: number } = {}): {
  segments: Seg[];
  counts: Record<string, number>;
  unitsLabel: string;
} {
  const doc = readDoc(text);
  const u = unitsFactor(doc.insunits);
  const tolIn = opts.tolIn ?? 0.003;
  const counts: Record<string, number> = {};
  const toIn: Xform = (p) => ({ x: p.x * u.f, y: p.y * u.f });
  const segments = entitySegments(doc.entities, doc, toIn, tolIn, counts, 0, u.f).filter((s) =>
    [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite),
  );
  return { segments, counts, unitsLabel: u.label };
}

/* ---------------------------- loops ---------------------------- */

export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return s / 2;
}

function perimeter(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
  }
  return s;
}

export function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Chains segments into closed outlines. Endpoints within `gapIn` are treated
 * as the same point (CAD exports often leave hairline gaps). Duplicate
 * segments (a line drawn twice) are dropped. Returns closed loops and the
 * number of chains that never closed.
 */
export function buildLoops(segments: Seg[], gapIn = 0.005): { loops: Pt[][]; openChains: number } {
  // cluster endpoints on a grid of gapIn (checking neighbor cells)
  const cell = Math.max(gapIn, 1e-6);
  const grid = new Map<string, number[]>();
  const nodes: Pt[] = [];
  const nodeOf = (p: Pt): number => {
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of grid.get(`${gx + dx},${gy + dy}`) || []) {
          if (Math.hypot(nodes[id].x - p.x, nodes[id].y - p.y) <= gapIn) return id;
        }
      }
    const id = nodes.length;
    nodes.push({ x: p.x, y: p.y });
    const k = `${gx},${gy}`;
    grid.set(k, [...(grid.get(k) || []), id]);
    return id;
  };

  type E = { a: number; b: number; used: boolean };
  const edges: E[] = [];
  const seen = new Set<string>();
  const adj = new Map<number, number[]>();
  for (const s of segments) {
    const a = nodeOf({ x: s.x1, y: s.y1 });
    const b = nodeOf({ x: s.x2, y: s.y2 });
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = edges.length;
    edges.push({ a, b, used: false });
    adj.set(a, [...(adj.get(a) || []), id]);
    adj.set(b, [...(adj.get(b) || []), id]);
  }

  const loops: Pt[][] = [];
  let openChains = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    edges[i].used = true;
    const start = edges[i].a;
    const path = [start, edges[i].b];
    // walk forward from b; prefer the unused edge that turns least (keeps
    // touching outlines apart where they share a point)
    let closed = false;
    for (let guard = 0; guard < edges.length + 1; guard++) {
      const head = path[path.length - 1];
      if (head === start) {
        closed = true;
        break;
      }
      const prev = nodes[path[path.length - 2]];
      const h = nodes[head];
      const inA = Math.atan2(h.y - prev.y, h.x - prev.x);
      let best = -1;
      let bestTurn = Infinity;
      for (const eid of adj.get(head) || []) {
        const e = edges[eid];
        if (e.used) continue;
        const nxt = nodes[e.a === head ? e.b : e.a];
        let turn = Math.atan2(nxt.y - h.y, nxt.x - h.x) - inA;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        while (turn < -Math.PI) turn += 2 * Math.PI;
        if (Math.abs(turn) < bestTurn) {
          bestTurn = Math.abs(turn);
          best = eid;
        }
      }
      if (best < 0) break;
      edges[best].used = true;
      path.push(edges[best].a === head ? edges[best].b : edges[best].a);
    }
    if (!closed) {
      openChains++;
      continue;
    }
    path.pop();
    const pts = path.map((id) => nodes[id]);
    if (pts.length >= 3 && Math.abs(signedArea(pts)) > 1e-6) loops.push(pts);
  }
  return { loops, openChains };
}

/** Drops points closer than minEdge to the previous one (keeps the shape). */
function tidy(pts: Pt[], minEdge = 0.01): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && Math.hypot(p.x - l.x, p.y - l.y) < minEdge) continue;
    out.push(p);
  }
  if (out.length > 3 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < minEdge) out.pop();
  return out.length >= 3 ? out : pts;
}

/* --------------------------- dxfToFaces --------------------------- */

/**
 * Reads a DXF and returns one faces JSON per insert. Within an insert, the
 * outline is counter-clockwise (+ area), cavities clockwise (- area), and
 * islands inside a cavity + again, which is how facesJsonToLayoutSeed tells
 * them apart. Inserts are ordered left to right, then top to bottom.
 */
export function dxfToFaces(text: string, opts: { gapIn?: number } = {}): DxfResult {
  const warnings: string[] = [];
  const parsed = parseDxf(text);
  const { loops, openChains } = buildLoops(parsed.segments, opts.gapIn ?? 0.005);
  if (openChains) warnings.push(`${openChains} line${openChains === 1 ? "" : "s"} / chain${openChains === 1 ? "" : "s"} didn't close into a shape and were skipped.`);

  const info = loops
    .map((pts) => ({ pts: tidy(pts), area: Math.abs(signedArea(pts)) }))
    .sort((a, b) => b.area - a.area);
  // parent = smallest bigger loop that contains this one
  const parent: number[] = info.map(() => -1);
  for (let i = 0; i < info.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (info[j].area <= info[i].area) continue;
      const probe = info[i].pts[0];
      const mid = {
        x: (info[i].pts[0].x + info[i].pts[Math.floor(info[i].pts.length / 2)].x) / 2,
        y: (info[i].pts[0].y + info[i].pts[Math.floor(info[i].pts.length / 2)].y) / 2,
      };
      if (pointInPoly(probe, info[j].pts) || pointInPoly(mid, info[j].pts)) {
        parent[i] = j; // sorted big->small, so walking back from i finds the tightest first
        break;
      }
    }
  }
  const depthOf = (i: number): number => (parent[i] < 0 ? 0 : 1 + depthOf(parent[i]));
  const rootOf = (i: number): number => (parent[i] < 0 ? i : rootOf(parent[i]));

  const roots = info
    .map((_, i) => i)
    .filter((i) => parent[i] < 0)
    .map((i) => {
      const xs = info[i].pts.map((p) => p.x);
      const ys = info[i].pts.map((p) => p.y);
      return { i, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    })
    // tiny stray shapes (< 0.25 sq in) on their own are not inserts
    .filter((r) => info[r.i].area >= 0.25)
    .sort((a, b) => (Math.abs(a.minX - b.minX) > 0.5 ? a.minX - b.minX : b.maxY - a.maxY));

  const inserts: DxfFaces[] = roots.map((r, n) => {
    const members = info.map((_, i) => i).filter((i) => rootOf(i) === r.i);
    const loopsOut: FacesLoop[] = members.map((i, idx) => {
      const d = depthOf(i);
      let pts = info[i].pts;
      const a = signedArea(pts);
      const wantPositive = d % 2 === 0;
      if (a > 0 !== wantPositive) pts = [...pts].reverse();
      return {
        idx,
        closed: true,
        area: signedArea(pts),
        perimeter: perimeter(pts),
        edges: pts.length,
        points: pts.map((p) => ({ x: round(p.x), y: round(p.y) })),
      };
    });
    return {
      units: "in",
      outerLoopIndex: 0,
      loopsCount: loopsOut.length,
      loops: loopsOut,
      source: "dxf",
      insert: { index: n, count: roots.length, lengthIn: round(r.maxX - r.minX), widthIn: round(r.maxY - r.minY) },
      warnings: [],
    };
  });

  if (!inserts.length) warnings.push("No closed outline found in this DXF.");
  return {
    inserts,
    warnings,
    stats: { entities: parsed.counts, segments: parsed.segments.length, loops: loops.length, openChains, unitsLabel: parsed.unitsLabel },
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
