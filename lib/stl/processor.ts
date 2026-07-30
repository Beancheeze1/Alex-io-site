// lib/stl/processor.ts
//
// STL processing logic ported from CORS_edit worker
// Extracts top-face geometry and builds loops for layout editor

type Vec3 = [number, number, number];

type StlTri = {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  normal?: Vec3;
};

type Point2 = { x: number; y: number };

type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer?: string | null;
};

type Loop = {
  idx: number;
  points: Point2[];
  closed: boolean;
  area: number;
  perimeter: number;
};

type UnitZone = "confident-in" | "ambiguous" | "confident-mm" | "unknown";

type UnitDetection = {
  zone: UnitZone;
  maxDimRaw: number;
  appliedAs: "in" | "mm";
};

type FacesJson = {
  units: "in" | "mm";
  outerLoopIndex: number;
  loopsCount: number;
  loops: Array<{
    idx: number;
    closed: boolean;
    area: number;
    perimeter: number;
    edges: number;
    points: Point2[];
  }>;

  // NEW: real block thickness (already converted to inches) read from the
  // STL mesh's own Z-height, when available. Only ever set by the STL path
  // — DXF/PDF sources carry no Z data at all, so callers must keep treating
  // a missing thicknessIn exactly as before (2in default).
  thicknessIn?: number;

  // NEW: how the mm-vs-inches guess was made, surfaced so the caller can
  // show the assumption to the user instead of applying it invisibly.
  unitDetection?: UnitDetection;
};

/* ----------------------- STL PARSING ----------------------- */

function isProbablyBinaryStl(buf: Buffer): boolean {
  if (buf.length < 84) return false;
  const header = buf.toString("utf8", 0, Math.min(80, buf.length));
  if (/^\s*solid\s+/i.test(header)) return false;
  return true;
}

function parseStl(buf: Buffer): StlTri[] {
  if (!buf || buf.length < 20) return [];
  if (isProbablyBinaryStl(buf)) return parseBinaryStl(buf);
  return parseAsciiStl(buf.toString("utf8"));
}

function parseBinaryStl(buf: Buffer): StlTri[] {
  if (buf.length < 84) return [];
  const triCount = buf.readUInt32LE(80);
  const out: StlTri[] = [];
  let off = 84;

  for (let i = 0; i < triCount; i++) {
    if (off + 50 > buf.length) break;

    const nx = buf.readFloatLE(off + 0);
    const ny = buf.readFloatLE(off + 4);
    const nz = buf.readFloatLE(off + 8);

    const ax = buf.readFloatLE(off + 12);
    const ay = buf.readFloatLE(off + 16);
    const az = buf.readFloatLE(off + 20);

    const bx = buf.readFloatLE(off + 24);
    const by = buf.readFloatLE(off + 28);
    const bz = buf.readFloatLE(off + 32);

    const cx = buf.readFloatLE(off + 36);
    const cy = buf.readFloatLE(off + 40);
    const cz = buf.readFloatLE(off + 44);

    out.push({
      a: [ax, ay, az],
      b: [bx, by, bz],
      c: [cx, cy, cz],
      normal: [nx, ny, nz],
    });

    off += 50;
  }

  return out;
}

function parseAsciiStl(text: string): StlTri[] {
  const out: StlTri[] = [];
  if (!text) return out;

  const lines = text.split(/\r?\n/);
  let curNormal: Vec3 | undefined;
  let verts: Vec3[] = [];

  function flush() {
    if (verts.length === 3) {
      out.push({ a: verts[0], b: verts[1], c: verts[2], normal: curNormal });
    }
    verts = [];
    curNormal = undefined;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const low = line.toLowerCase();

    if (low.startsWith("facet normal")) {
      const parts = line.split(/\s+/);
      const nx = Number(parts[2]);
      const ny = Number(parts[3]);
      const nz = Number(parts[4]);
      if ([nx, ny, nz].every(Number.isFinite)) curNormal = [nx, ny, nz];
      continue;
    }

    if (low.startsWith("vertex")) {
      const parts = line.split(/\s+/);
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if ([x, y, z].every(Number.isFinite)) verts.push([x, y, z]);
      continue;
    }

    if (low.startsWith("endfacet")) {
      flush();
      continue;
    }
  }

  if (verts.length === 3) flush();

  return out;
}

/* ----------------------- VECTOR MATH ----------------------- */

function vsub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vcross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vlen(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function vnorm(a: Vec3): Vec3 {
  const d = vlen(a);
  if (!Number.isFinite(d) || d <= 1e-18) return [0, 0, 0];
  return [a[0] / d, a[1] / d, a[2] / d];
}

function triArea(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = vsub(b, a);
  const ac = vsub(c, a);
  return vlen(vcross(ab, ac)) / 2;
}

/* ----------------------- GEOMETRY HELPERS ----------------------- */

function quantize(v: number, eps: number): number {
  return Math.round(v / eps) * eps;
}

function key2(x: number, y: number): string {
  return `${x},${y}`;
}

function edgeKeyUndirected2(ka: string, kb: string): string {
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function bbox3(tris: StlTri[]) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
      maxZ = Math.max(maxZ, p[2]);
    }
  }

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null;

  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;
  const maxDim = Math.max(sx, sy, sz);

  return { minX, minY, minZ, maxX, maxY, maxZ, sx, sy, sz, maxDim };
}

// STL carries no unit metadata at all, so any inches-vs-millimeters call is a
// guess from raw magnitude alone. A single cutoff (the old "> 50 -> mm" rule)
// silently mangled a real 60x40x4in part into 2.38x1.63in with zero warning,
// because a bare number like 60 is genuinely plausible as either a modest
// inches-scale block (this catalog goes up to ~84in) or a small mm-native
// part (60mm = 2.36in). There is no numeric threshold that can safely
// resolve that overlap — so instead of picking a single magic number, this
// only auto-decides the unambiguous ends of the range and marks everything
// in between "ambiguous" so the caller can surface the assumption (and let
// the user flip it) rather than applying it invisibly.
const CONFIDENT_IN_MAX_DIM = 40; // below this, essentially always inches for this business
const CONFIDENT_MM_MIN_DIM = 100; // above this, essentially never a realistic inches-scale foam block

function classifyStlUnits(maxDim: number): { scaleToIn: number; unitGuess: "mm" | "in" | "?"; zone: UnitZone } {
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    return { scaleToIn: 1, unitGuess: "?", zone: "unknown" };
  }

  if (maxDim > CONFIDENT_MM_MIN_DIM) {
    return { scaleToIn: 1 / 25.4, unitGuess: "mm", zone: "confident-mm" };
  }

  if (maxDim <= CONFIDENT_IN_MAX_DIM) {
    return { scaleToIn: 1, unitGuess: "in", zone: "confident-in" };
  }

  // Ambiguous middle zone: default to NOT rescaling. Inches is this
  // business's native unit, and leaving a genuinely-mm file too large is far
  // easier for a human to notice and correct than a real part silently
  // shrunk to a fraction of its size (the bug this replaces).
  return { scaleToIn: 1, unitGuess: "in", zone: "ambiguous" };
}

/* ----------------------- TOP FACE EXTRACTION ----------------------- */

function extractTopFaceSegmentsFromStl(tris: StlTri[]): { segments: Segment[]; diagnostics: any } {
  if (!tris.length) return { segments: [], diagnostics: { reason: "no_triangles" } };

  const bb = bbox3(tris);
  if (!bb) return { segments: [], diagnostics: { reason: "bbox_failed" } };

  const { scaleToIn, unitGuess, zone } = classifyStlUnits(bb.maxDim);

  const epsXY = Math.max(1e-9, bb.maxDim * 1e-6);
  const epsZ = Math.max(1e-9, bb.maxDim * 1e-6);

  const cosMaxTilt = Math.cos((8 * Math.PI) / 180);
  const zMax = bb.maxZ;

  const bins = new Map<number, { area: number; idxs: number[] }>();

  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const n = vnorm(t.normal ?? vcross(vsub(t.b, t.a), vsub(t.c, t.a)));
    if (!Number.isFinite(n[2])) continue;
    if (n[2] < cosMaxTilt) continue;

    const zAvg = (t.a[2] + t.b[2] + t.c[2]) / 3;
    if (zAvg < zMax - epsZ * 50) continue;

    const a = triArea(t.a, t.b, t.c);
    if (!Number.isFinite(a) || a <= 0) continue;

    const zBin = Math.round(zAvg / epsZ) * epsZ;
    const rec = bins.get(zBin) ?? { area: 0, idxs: [] };
    rec.area += a;
    rec.idxs.push(i);
    bins.set(zBin, rec);
  }

  if (!bins.size) {
    return {
      segments: [],
      diagnostics: {
        reason: "no_top_plane_triangles",
        maxZ: zMax,
        epsZ,
        cosMaxTilt,
      },
    };
  }

  let bestZ = 0;
  let bestArea = -Infinity;
  let bestIdxs: number[] = [];

  for (const [z, rec] of bins) {
    if (rec.area > bestArea) {
      bestArea = rec.area;
      bestZ = z;
      bestIdxs = rec.idxs;
    }
  }

  const edgeCounts = new Map<string, { a: string; b: string; ax: number; ay: number; bx: number; by: number }>();
  const counts = new Map<string, number>();

  function addEdge2(p0: Vec3, p1: Vec3) {
    const ax = quantize(p0[0], epsXY);
    const ay = quantize(p0[1], epsXY);
    const bx = quantize(p1[0], epsXY);
    const by = quantize(p1[1], epsXY);

    const ka = key2(ax, ay);
    const kb = key2(bx, by);
    if (ka === kb) return;

    const k = edgeKeyUndirected2(ka, kb);
    if (!edgeCounts.has(k)) {
      edgeCounts.set(k, { a: ka, b: kb, ax, ay, bx, by });
    }
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  for (const idx of bestIdxs) {
    const t = tris[idx];
    addEdge2(t.a, t.b);
    addEdge2(t.b, t.c);
    addEdge2(t.c, t.a);
  }

  const segments: Segment[] = [];
  for (const [k, rec] of edgeCounts) {
    const c = counts.get(k) ?? 0;
    if (c !== 1) continue;
    segments.push({
      x1: rec.ax * scaleToIn,
      y1: rec.ay * scaleToIn,
      x2: rec.bx * scaleToIn,
      y2: rec.by * scaleToIn,
      layer: "TOP",
    });
  }

  return {
    segments,
    diagnostics: {
      topPlaneZ: bestZ,
      topPlaneArea: bestArea,
      triCountTop: bestIdxs.length,
      boundarySegmentCount: segments.length,
      epsXY,
      epsZ,
      maxDim: bb.maxDim,
      unitGuess,
      zone,
      scaleToIn,
      maxDimIn: bb.maxDim * scaleToIn,
      // Real Z-height of the mesh, converted to inches with the same scale
      // applied to X/Y, so the caller can use it as the layer's real
      // thickness instead of a hardcoded default.
      thicknessIn: bb.sz * scaleToIn,
    },
  };
}

/* ----------------------- LOOP BUILDING ----------------------- */

function signedArea(pts: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return sum / 2;
}

function loopPerimeter(pts: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
  }
  return sum;
}

// Below typical foam-cutting tolerance (1/16in) -- these are collapsed rather
// than sent downstream (STEP export, 2D rendering) as if they were real
// geometry. Top-face boundary tracing occasionally produces near-duplicate
// consecutive vertices (a few thousandths to a few hundredths of an inch
// apart) from the underlying mesh's own triangulation/tessellation noise,
// not from any real feature of the part.
const MIN_LOOP_EDGE_IN = 0.05;

function simplifyClosedLoopPoints(points: Point2[], minEdgeIn: number): Point2[] {
  if (points.length < 4) return points; // never simplify a bare triangle/quad

  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < minEdgeIn) continue;
    out.push(p);
  }

  // Wraparound: also check the closing edge (last point back to first).
  if (out.length > 3) {
    const a = out[out.length - 1];
    const b = out[0];
    if (Math.hypot(b.x - a.x, b.y - a.y) < minEdgeIn) out.pop();
  }

  // Never simplify a loop down to something degenerate -- fall back to the
  // original points rather than silently dropping the loop entirely.
  return out.length >= 3 ? out : points;
}

function buildLoopsFromSegments(segments: Segment[], tol = 1e-6): Loop[] {
  const segsIn = Array.isArray(segments) ? segments : [];

  // Compute a scale-aware snap grid from the segment bbox.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of segsIn) {
    if (![s?.x1, s?.y1, s?.x2, s?.y2].every(Number.isFinite)) continue;
    xs.push(Number(s.x1), Number(s.x2));
    ys.push(Number(s.y1), Number(s.y2));
  }

  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const diag = Math.hypot(spanX, spanY);

  // Snap grid - CRITICAL for proper loop closure
  const snap = Math.max(1e-6, Number.isFinite(diag) && diag > 0 ? diag * 1e-8 : 1e-6);
  const eqTol = Math.max(tol, snap * 2);

  const q = (n: number) => {
    if (!Number.isFinite(n)) return n;
    return Math.round(n / snap) * snap;
  };

  // Drop near-zero-length segments
  const minLen = snap * 0.5;

  const clean: Segment[] = [];
  for (const s of segsIn) {
    const x1 = q(Number(s.x1));
    const y1 = q(Number(s.y1));
    const x2 = q(Number(s.x2));
    const y2 = q(Number(s.y2));
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!Number.isFinite(len) || len < minLen) continue;

    clean.push({ x1, y1, x2, y2, layer: s.layer });
  }

  const used = new Set<number>();
  const loops: Loop[] = [];

  function same(a: Point2, b: Point2) {
    return Math.abs(a.x - b.x) <= eqTol && Math.abs(a.y - b.y) <= eqTol;
  }

  for (let i = 0; i < clean.length; i++) {
    if (used.has(i)) continue;

    const pts: Point2[] = [];
    const s = clean[i];
    used.add(i);

    pts.push({ x: s.x1, y: s.y1 });
    pts.push({ x: s.x2, y: s.y2 });

    let extended = true;
    while (extended) {
      extended = false;

      const head = pts[pts.length - 1];

      for (let j = 0; j < clean.length; j++) {
        if (used.has(j)) continue;
        const c = clean[j];

        if (same(head, { x: c.x1, y: c.y1 })) {
          pts.push({ x: c.x2, y: c.y2 });
          used.add(j);
          extended = true;
          break;
        } else if (same(head, { x: c.x2, y: c.y2 })) {
          pts.push({ x: c.x1, y: c.y1 });
          used.add(j);
          extended = true;
          break;
        }
      }
    }

    const closed = same(pts[0], pts[pts.length - 1]);
    if (closed) pts.pop();

    const simplifiedPts = closed ? simplifyClosedLoopPoints(pts, MIN_LOOP_EDGE_IN) : pts;

    if (simplifiedPts.length < 3) continue;

    const a = signedArea(simplifiedPts);
    loops.push({
      idx: loops.length,
      points: simplifiedPts,
      closed,
      area: a,
      perimeter: loopPerimeter(simplifiedPts),
    });
  }

  // Keep only closed, non-degenerate loops
  const closedLoops = loops.filter(
    (l) => l.closed && Number.isFinite(l.area) && Math.abs(l.area) > Math.max(eqTol, 1e-9),
  );

  // MODIFIED: Keep ALL closed loops including nested cavities (holes-within-holes)
  // This allows proper representation of complex geometries where cavities have
  // their own internal cutouts.
  return closedLoops;
}

/* ----------------------- PUBLIC API ----------------------- */

export function stlToFacesJson(buf: Buffer): FacesJson {
  const tris = parseStl(buf);
  
  if (!tris.length) {
    throw new Error("STL parse yielded 0 triangles");
  }

  const res = extractTopFaceSegmentsFromStl(tris);
  
  if (!res.segments.length) {
    throw new Error("No drawable geometry found in STL");
  }

  const loops = buildLoopsFromSegments(res.segments);

  console.log(`[STL Processor] Total loops found: ${loops.length}`);
  loops.forEach((l, idx) => {
    console.log(`  Loop ${idx}: closed=${l.closed}, area=${l.area.toFixed(6)}, points=${l.points.length}`);
  });

  // Find outer loop (largest absolute area, should be positive)
  let outerIdx = 0;
  let maxAbsArea = 0;
  
  for (let i = 0; i < loops.length; i++) {
    const absArea = Math.abs(loops[i].area);
    if (absArea > maxAbsArea) {
      maxAbsArea = absArea;
      outerIdx = i;
    }
  }

  console.log(`[STL Processor] Outer loop identified: index=${outerIdx}, area=${loops[outerIdx].area.toFixed(6)}`);
  console.log(`[STL Processor] Cavity loops: ${loops.length - 1} (all non-outer loops)`);
  console.log(
    `[STL Processor] Units: zone=${res.diagnostics.zone}, appliedAs=${res.diagnostics.unitGuess}, ` +
      `maxDimRaw=${res.diagnostics.maxDim}, thicknessIn=${res.diagnostics.thicknessIn}`,
  );

  const thicknessIn = Number(res.diagnostics.thicknessIn);

  return {
    units: "in",
    outerLoopIndex: outerIdx,
    loopsCount: loops.length,
    loops: loops.map((l) => ({
      idx: l.idx,
      closed: l.closed,
      area: l.area,
      perimeter: l.perimeter,
      edges: l.points.length,
      points: l.points,
    })),
    thicknessIn: Number.isFinite(thicknessIn) && thicknessIn > 0 ? thicknessIn : undefined,
    unitDetection: {
      zone: res.diagnostics.zone,
      maxDimRaw: res.diagnostics.maxDim,
      appliedAs: res.diagnostics.unitGuess === "mm" ? "mm" : "in",
    },
  };
}