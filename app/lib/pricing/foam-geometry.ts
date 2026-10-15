// app/lib/pricing/foam-geometry.ts
//
// Step 23: what the foam pricing needs to know about a saved layout
// (quote_layout_packages.layout_json). Pure — no DB.
//
//   cavity_ci        cavity volume removed from ONE finished piece, per layer:
//                    cavity area × min(cavity depth, layer thickness)
//   cut_in_per_piece inches of cut for one finished piece: every layer's
//                    outline + every cavity outline in that layer
//                    (CNC time = cut inches ÷ feed rate)
//   dies             one steel-rule die per DIFFERENT layer pattern (layers
//                    with the same outline + cavities share a die); rule
//                    inches = that layer's outline + its cavity outlines
//   layers_cut       pieces cut per finished part (one per layer)
//   glue_lines       glued joints per finished part = layers − 1, not
//                    counting layers marked loose (loose: true)
//
// Shapes follow the CAD exports (app/lib/layout/exports.ts): poly points are
// 0–1 fractions of the block length/width; a circle uses diameterIn, else
// the smaller of length/width; cornerRadiusIn > 0 makes a rounded rectangle.

export type FoamLayerGeom = {
  thickness_in: number;
  outline_in: number;
  cavity_perimeter_in: number;
  cavity_ci: number;
  cavity_count: number;
  loose: boolean;
  signature: string;
};

export type FoamGeometry = {
  length_in: number;
  width_in: number;
  height_in: number;
  layers: FoamLayerGeom[];
  cavity_ci: number;
  cut_in_per_piece: number;
  layers_cut: number;
  glue_lines: number;
  dies: { signature: string; rule_in: number; layers: number }[];
  rule_in_total: number;
  from_layout: boolean;
};

type AnyObj = Record<string, unknown>;

function n(v: unknown, fb = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fb;
}
function pos(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

type Pt = { x: number; y: number };

function polyPoints(cav: AnyObj, L: number, W: number): Pt[] | null {
  const pts = cav.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  const out = pts
    .map((p) => {
      const o = (p || {}) as AnyObj;
      const x = Number(o.x);
      const y = Number(o.y);
      return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp01(x) * L, y: clamp01(y) * W } : null;
    })
    .filter((p): p is Pt => !!p);
  return out.length >= 3 ? out : null;
}
function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
}
function polyPerimeter(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    s += Math.hypot(p[j].x - p[i].x, p[j].y - p[i].y);
  }
  return s;
}
function ellipsePerimeter(a: number, b: number): number {
  // Ramanujan's approximation (exact for a circle).
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b) || 1);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Area (sq in) and perimeter (in) of one cavity outline, nested holes included. */
export function cavityOutline(cav: AnyObj, L: number, W: number): { area: number; perimeter: number } {
  const len = n(cav.lengthIn ?? cav.length_in);
  const wid = n(cav.widthIn ?? cav.width_in);
  let area = 0;
  let perimeter = 0;

  const pts = polyPoints(cav, L, W);
  const shape = String(cav.shape ?? "").toLowerCase();
  const dia = pos(cav.diameterIn ?? cav.diameter_in);
  const cr = n(cav.cornerRadiusIn ?? cav.corner_radius_in);

  if (pts) {
    area = polyArea(pts);
    perimeter = polyPerimeter(pts);
  } else if (dia != null || shape === "circle") {
    const a = (dia ?? Math.min(len, wid)) / 2;
    const b = dia != null ? a : Math.min(len, wid) / 2;
    area = Math.PI * a * b;
    perimeter = ellipsePerimeter(a, b);
  } else if (cr > 0 && len > 0 && wid > 0) {
    const r = Math.min(cr, len / 2, wid / 2);
    area = len * wid - (4 - Math.PI) * r * r;
    perimeter = 2 * (len + wid) - 8 * r + 2 * Math.PI * r;
  } else {
    area = Math.max(len, 0) * Math.max(wid, 0);
    perimeter = 2 * (Math.max(len, 0) + Math.max(wid, 0));
  }

  // Holes inside the cavity (islands left standing): less foam removed, more cut.
  const nested = cav.nestedCavities;
  if (Array.isArray(nested)) {
    for (const h of nested) {
      const hp = polyPoints((h || {}) as AnyObj, L, W);
      if (hp) {
        area -= polyArea(hp);
        perimeter += polyPerimeter(hp);
      }
    }
  }
  return { area: Math.max(area, 0), perimeter: Math.max(perimeter, 0) };
}

function outlinePerimeter(L: number, W: number, block: AnyObj, layer: AnyObj): number {
  let p = 2 * (L + W);
  if (layer.roundCorners === true) {
    const r = Math.min(n(layer.roundRadiusIn, 0.25), L / 2, W / 2);
    p += -8 * r + 2 * Math.PI * r;
  } else if (layer.cropCorners === true || String(block.cornerStyle ?? "") === "chamfer") {
    const c = Math.min(n(block.chamferIn, 0), L / 2, W / 2);
    p -= 4 * c * (2 - Math.SQRT2);
  }
  return p;
}

/**
 * Geometry for one finished piece. `layout` is the saved layout_json (or
 * null); `fallback` is the PRIMARY line's L×W×H, used when there's no layout
 * (a single solid layer with no cavities).
 */
export function foamGeometry(layout: unknown, fallback: { L: number; W: number; H: number }): FoamGeometry {
  const lay = (layout && typeof layout === "object" ? layout : {}) as AnyObj;
  const block = (lay.block && typeof lay.block === "object" ? lay.block : {}) as AnyObj;
  const L = pos(block.lengthIn) ?? fallback.L;
  const W = pos(block.widthIn) ?? fallback.W;

  let rawLayers: AnyObj[] = [];
  if (Array.isArray(lay.stack) && lay.stack.length > 0) {
    rawLayers = lay.stack.filter((x) => x && typeof x === "object") as AnyObj[];
  } else if (pos(block.thicknessIn) != null) {
    rawLayers = [{ thicknessIn: block.thicknessIn, cavities: Array.isArray(lay.cavities) ? lay.cavities : [] }];
  }
  const fromLayout = rawLayers.length > 0;
  if (!fromLayout) rawLayers = [{ thicknessIn: fallback.H, cavities: [] }];

  const layers: FoamLayerGeom[] = rawLayers.map((ly) => {
    const t = pos(ly.thicknessIn ?? ly.thickness_in) ?? 0;
    const cavs = (Array.isArray(ly.cavities) ? ly.cavities : []).filter((c) => c && typeof c === "object") as AnyObj[];
    let cavity_ci = 0;
    let cavity_perimeter_in = 0;
    const sig: string[] = [];
    for (const c of cavs) {
      const o = cavityOutline(c, L, W);
      const depth = Math.min(pos(c.depthIn ?? c.depth_in) ?? t, t);
      cavity_ci += o.area * depth;
      cavity_perimeter_in += o.perimeter;
      sig.push(`${r3(o.area)}:${r3(o.perimeter)}:${r3(n(c.x))}:${r3(n(c.y))}`);
    }
    const outline_in = outlinePerimeter(L, W, block, ly);
    sig.sort();
    return {
      thickness_in: t,
      outline_in,
      cavity_perimeter_in,
      cavity_ci,
      cavity_count: cavs.length,
      loose: ly.loose === true,
      signature: `${r3(outline_in)}|${sig.join(",")}`,
    };
  });

  const dieMap = new Map<string, { signature: string; rule_in: number; layers: number }>();
  for (const ly of layers) {
    const d = dieMap.get(ly.signature);
    if (d) d.layers++;
    else dieMap.set(ly.signature, { signature: ly.signature, rule_in: ly.outline_in + ly.cavity_perimeter_in, layers: 1 });
  }
  const dies = Array.from(dieMap.values());
  const glued = layers.filter((l) => !l.loose).length;

  return {
    length_in: L,
    width_in: W,
    height_in: layers.reduce((s, l) => s + l.thickness_in, 0) || fallback.H,
    layers,
    cavity_ci: r3(layers.reduce((s, l) => s + l.cavity_ci, 0)),
    cut_in_per_piece: r3(layers.reduce((s, l) => s + l.outline_in + l.cavity_perimeter_in, 0)),
    layers_cut: layers.length,
    glue_lines: Math.max(glued - 1, 0),
    dies: dies.map((d) => ({ ...d, rule_in: r3(d.rule_in) })),
    rule_in_total: r3(dies.reduce((s, d) => s + d.rule_in, 0)),
    from_layout: fromLayout,
  };
}
