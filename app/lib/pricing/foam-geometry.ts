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
// Step 39L: withSheets(geom, stock) is how a quote priced from Step 39L on
// counts lamination (foam-process.ts uses it when the quote's lock has
// lam_rule 2). Each layer is its own piece, built from sheets:
//   - a glue line at the floor of every cavity that doesn't go all the way
//     through the layer (the sheets above it are cut through, the ones below
//     aren't), so a 3" bottom with a 1" and a 1.5" deep cavity is 3 bands:
//     0–1" (both cavities cut), 1–1.5" (one cavity cut), 1.5–3" (solid);
//   - each band is built from the shop's stock sheet thicknesses (up to 4)
//     with the fewest sheets, then the least extra foam; when the sheets
//     come out thicker than the band, one sheet is skived down;
//   - a glue line between two layers unless one of them is a separate piece
//     (layerIsLoose: marked loose, named like "Top Pad" / "Lid", or the
//     top-most layer of the set, which is packed loose as the quote's
//     Construction note says).
//   glue_lines = Σ (sheets in each layer − 1) + glued joints between layers
//   layers_cut = sheets (one press hit each); dies = one per DIFFERENT sheet
//   pattern (outline + the cavities cut through it); cut_in_per_piece (CNC)
//   = each band cut once (its sheets laminated first).
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
  /** Step 39L: a separate piece (layerIsLoose: marked, named like "Top Pad", or the top-most layer). */
  loose: boolean;
  /** Marked loose: true on the layout (the rule for quotes priced before Step 39L). */
  loose_marked: boolean;
  signature: string;
  /** Step 39L: each cavity's depth (capped at the layer), outline and pattern key; index = its place in the layer's cavities (Step 39M). */
  cavities: { index: number; depth_in: number; perimeter_in: number; key: string }[];
};

/** Step 39L: one sheet of foam in a finished part (withSheets). */
export type FoamSheet = {
  layer: number; // 1-based layer
  n: number; // Step 39M: 1-based sheet in its layer, from the cavity face
  from_in: number; // depth of its top face in the layer
  thickness_in: number; // after skiving
  stock_in: number | null; // the stock sheet it's cut from (null = no stock sizes set)
  skived: boolean;
  pattern: string;
  cut_in: number; // outline + cavities cut through it
  cavity_index: number[]; // Step 39M: the layer's cavities cut through it (their index in the layer)
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
  /** Step 39L: set by withSheets. */
  sheets?: FoamSheet[];
  stock_in?: number[];
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
/**
 * Step 39L: is this layer a separate piece (not glued to its neighbours)?
 * loose: true / false on the layer wins; else a layer named like a separate
 * piece ("Top Pad", "Lid", "Loose", "Separate"), or the top-most layer of a
 * set of 2 or more (`isTop`), is separate.
 */
const LOOSE_LABEL = /\b(top[\s-]*pad|lid|loose|separate)\b/i;
export function layerIsLoose(layer: { loose?: unknown; label?: unknown }, isTop = false): boolean {
  if (layer.loose === true) return true;
  if (layer.loose === false) return false;
  return isTop || LOOSE_LABEL.test(String(layer.label ?? ""));
}

/** Step 39L: the shop's stock sheet thicknesses: positive, different, thickest first, up to 4. */
export function cleanStockList(v: unknown[]): number[] {
  const out: number[] = [];
  for (const x of v) {
    const t = r3(Number(x));
    if (Number.isFinite(t) && t > 0 && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => b - a).slice(0, 4);
}

/**
 * Step 39L: the sheets for a band `s` inches thick: the fewest sheets from
 * `stock` that reach s, then the least extra foam. [s] when there's no stock.
 */
export function stockBuild(s: number, stock: number[]): number[] {
  const t = r3(s);
  const st = cleanStockList(stock);
  if (!(t > 0)) return [];
  if (st.length === 0) return [t];
  const k = Math.max(1, Math.ceil(t / st[0] - 1e-9));
  if (k > 40) return Array.from({ length: k }, () => st[0]);
  let best: number[] | null = null;
  let bestSum = Infinity;
  const pick: number[] = [];
  const walk = (from: number, left: number, sum: number) => {
    if (left === 0) {
      if (sum >= t - 0.001 && sum < bestSum - 0.0005) {
        bestSum = sum;
        best = pick.slice();
      }
      return;
    }
    for (let i = from; i < st.length; i++) {
      pick.push(st[i]);
      walk(i, left - 1, sum + st[i]);
      pick.pop();
    }
  };
  walk(0, k, 0);
  return best ?? Array.from({ length: k }, () => st[0]);
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

  const layers: FoamLayerGeom[] = rawLayers.map((ly, li) => {
    const t = pos(ly.thicknessIn ?? ly.thickness_in) ?? 0;
    // Step 39M: keep each cavity's place in the layer (the job ticket's sheet DXFs pick cavities by it)
    const cavs = (Array.isArray(ly.cavities) ? ly.cavities : [])
      .map((c, index) => ({ c, index }))
      .filter((x) => x.c && typeof x.c === "object") as { c: AnyObj; index: number }[];
    let cavity_ci = 0;
    let cavity_perimeter_in = 0;
    const sig: string[] = [];
    const cavities: FoamLayerGeom["cavities"] = [];
    for (const { c, index } of cavs) {
      const o = cavityOutline(c, L, W);
      const depth = Math.min(pos(c.depthIn ?? c.depth_in) ?? t, t);
      cavity_ci += o.area * depth;
      cavity_perimeter_in += o.perimeter;
      const key = `${r3(o.area)}:${r3(o.perimeter)}:${r3(n(c.x))}:${r3(n(c.y))}`;
      sig.push(key);
      cavities.push({ index, depth_in: r3(depth), perimeter_in: o.perimeter, key });
    }
    const outline_in = outlinePerimeter(L, W, block, ly);
    sig.sort();
    return {
      thickness_in: t,
      outline_in,
      cavity_perimeter_in,
      cavity_ci,
      cavity_count: cavs.length,
      loose: layerIsLoose(ly, rawLayers.length > 1 && li === rawLayers.length - 1),
      loose_marked: ly.loose === true,
      signature: `${r3(outline_in)}|${sig.join(",")}`,
      cavities,
    };
  });

  const dieMap = new Map<string, { signature: string; rule_in: number; layers: number }>();
  for (const ly of layers) {
    const d = dieMap.get(ly.signature);
    if (d) d.layers++;
    else dieMap.set(ly.signature, { signature: ly.signature, rule_in: ly.outline_in + ly.cavity_perimeter_in, layers: 1 });
  }
  const dies = Array.from(dieMap.values());
  const glued = layers.filter((l) => !l.loose_marked).length;

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

/**
 * Step 39L: the geometry with lamination counted sheet by sheet (see the top
 * of this file). `stock` = the shop's stock sheet thicknesses (may be empty:
 * then each band is one sheet and only cavity floors and layer joints glue).
 */
export function withSheets(geom: FoamGeometry, stock: number[]): FoamGeometry {
  const st = cleanStockList(stock);
  const sheets: FoamSheet[] = [];
  let glue = 0;
  let cut = 0;
  geom.layers.forEach((ly, li) => {
    const t = r3(ly.thickness_in);
    if (!(t > 0)) return;
    const floors = Array.from(new Set(ly.cavities.map((c) => c.depth_in).filter((d) => d > 0.001 && d < t - 0.001))).sort((a, b) => a - b);
    const bounds = [0, ...floors, t];
    let inLayer = 0;
    for (let b = 0; b < bounds.length - 1; b++) {
      const from = bounds[b];
      const to = bounds[b + 1];
      const through = ly.cavities.filter((c) => c.depth_in >= to - 0.001);
      const bandCut = ly.outline_in + through.reduce((s, c) => s + c.perimeter_in, 0);
      const pattern = `${r3(ly.outline_in)}|${through.map((c) => c.key).sort().join(",")}`;
      cut += bandCut;
      const build = stockBuild(to - from, st);
      const extra = r3(build.reduce((s, x) => s + x, 0) - (to - from));
      let at = from;
      build.forEach((sheet, i) => {
        const skived = extra > 0.001 && i === build.length - 1;
        const thick = r3(skived ? sheet - extra : sheet);
        sheets.push({
          layer: li + 1,
          n: inLayer + i + 1,
          from_in: r3(at),
          thickness_in: thick,
          stock_in: st.length ? sheet : null,
          skived,
          pattern,
          cut_in: r3(bandCut),
          cavity_index: through.map((c) => c.index),
        });
        at += thick;
      });
      inLayer += build.length;
    }
    glue += Math.max(inLayer - 1, 0);
    const next = geom.layers[li + 1];
    if (next && !ly.loose && !next.loose) glue++;
  });

  const dieMap = new Map<string, { signature: string; rule_in: number; layers: number }>();
  for (const s of sheets) {
    const d = dieMap.get(s.pattern);
    if (d) d.layers++;
    else dieMap.set(s.pattern, { signature: s.pattern, rule_in: s.cut_in, layers: 1 });
  }
  const dies = Array.from(dieMap.values());
  return {
    ...geom,
    layers_cut: sheets.length,
    glue_lines: glue,
    cut_in_per_piece: r3(cut),
    dies: dies.map((d) => ({ ...d, rule_in: r3(d.rule_in) })),
    rule_in_total: r3(dies.reduce((s, d) => s + d.rule_in, 0)),
    sheets,
    stock_in: st,
  };
}
