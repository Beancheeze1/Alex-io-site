// app/lib/pricing/foam-review.ts
//
// Step 25: things the shop should check before a foam quote is released
// ("review flags"). Pure — no DB. Warnings only: they never change a price.
//
//   cavity_outside   a cavity runs past the edge of the part
//   cavity_too_deep  a cavity is deeper than its layer
//   cavity_overlap   two cavities in the same layer overlap
//   thin_wall        foam between a cavity and the edge, or between two
//                    cavities, is thinner than the shop's minimum wall
//   tiny_cavity      a cavity narrower than the shop's minimum feature
//   oversize         the part (or a layer) is bigger than the shop's largest
//                    block / bun
//   box_too_small    complete pack: the foam doesn't fit inside the box
//   box_too_shallow  complete pack: the foam stack is taller than the box
//   material_unpriced the material has no price (Step 22: shop default rate)
//
// Cavity positions follow the editor / CAD exports: x, y are 0–1 fractions
// of the block length / width for the cavity's top-left corner; poly cavities
// use their points' bounding box. Circles use their bounding square.

export type ReviewSettings = {
  foam_min_wall_in?: number | null;
  foam_min_feature_in?: number | null;
  foam_max_block_l_in?: number | null;
  foam_max_block_w_in?: number | null;
  foam_max_block_t_in?: number | null;
};

export const REVIEW_SETTING_KEYS = [
  "foam_min_wall_in",
  "foam_min_feature_in",
  "foam_max_block_l_in",
  "foam_max_block_w_in",
  "foam_max_block_t_in",
] as const;

export type ReviewFlag = {
  code:
    | "cavity_outside"
    | "cavity_too_deep"
    | "cavity_overlap"
    | "thin_wall"
    | "tiny_cavity"
    | "oversize"
    | "box_too_small"
    | "box_too_shallow"
    | "material_unpriced";
  message: string;
};

type AnyObj = Record<string, unknown>;
type Box = { x0: number; y0: number; x1: number; y1: number; name: string };

const EPS = 0.01;

function n(v: unknown, fb = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fb;
}
function pos(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}
function inch(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return `${r}"`;
}

function cavityBox(c: AnyObj, L: number, W: number, name: string): Box | null {
  const pts = c.points;
  if (Array.isArray(pts) && pts.length >= 3) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of pts) {
      const o = (p || {}) as AnyObj;
      if (Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y))) {
        xs.push(Number(o.x) * L);
        ys.push(Number(o.y) * W);
      }
    }
    if (xs.length < 3) return null;
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), name };
  }
  const dia = pos(c.diameterIn ?? c.diameter_in);
  const len = dia ?? n(c.lengthIn ?? c.length_in);
  const wid = dia ?? n(c.widthIn ?? c.width_in);
  if (!(len > 0 && wid > 0)) return null;
  const x0 = n(c.x) * L;
  const y0 = n(c.y) * W;
  return { x0, y0, x1: x0 + len, y1: y0 + wid, name };
}

/** Gap between two boxes (negative = they overlap). */
function gap(a: Box, b: Box): number {
  const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1);
  const dy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
  if (dx < 0 && dy < 0) return Math.max(dx, dy); // overlapping: negative
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy); // corner to corner
  return Math.max(dx, dy); // side by side
}

export function reviewFoam(args: {
  layout: unknown;
  fallback: { L: number; W: number; H: number };
  settings: ReviewSettings;
  boxes?: { L: number; W: number; H: number; label?: string | null }[];
  completePack?: boolean;
  materialUnpriced?: boolean;
}): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const lay = (args.layout && typeof args.layout === "object" ? args.layout : {}) as AnyObj;
  const block = (lay.block && typeof lay.block === "object" ? lay.block : {}) as AnyObj;
  const L = pos(block.lengthIn) ?? args.fallback.L;
  const W = pos(block.widthIn) ?? args.fallback.W;

  let layers: AnyObj[] = [];
  if (Array.isArray(lay.stack) && lay.stack.length > 0) layers = lay.stack.filter((x) => x && typeof x === "object") as AnyObj[];
  else if (pos(block.thicknessIn) != null) layers = [{ thicknessIn: block.thicknessIn, cavities: lay.cavities }];
  const H = layers.reduce((s, ly) => s + n(ly.thicknessIn), 0) || args.fallback.H;

  const minWall = n(args.settings.foam_min_wall_in);
  const minFeature = n(args.settings.foam_min_feature_in);
  const multi = layers.length > 1;

  layers.forEach((ly, li) => {
    const t = n(ly.thicknessIn ?? ly.thickness_in);
    const where = multi ? ` in layer ${li + 1}` : "";
    const cavs = (Array.isArray(ly.cavities) ? ly.cavities : []).filter((c) => c && typeof c === "object") as AnyObj[];
    const boxes: Box[] = [];
    cavs.forEach((c, ci) => {
      const name = `Cavity ${ci + 1}${where}`;
      const bx = cavityBox(c, L, W, name);
      const depth = n(c.depthIn ?? c.depth_in);
      if (t > 0 && depth > t + EPS) {
        flags.push({ code: "cavity_too_deep", message: `${name} is ${inch(depth)} deep but its layer is only ${inch(t)} thick.` });
      }
      if (!bx) return;
      boxes.push(bx);
      const w = Math.min(bx.x1 - bx.x0, bx.y1 - bx.y0);
      if (minFeature > 0 && w > 0 && w < minFeature - 1e-6) {
        flags.push({ code: "tiny_cavity", message: `${name} is only ${inch(w)} wide (shop minimum ${inch(minFeature)}).` });
      }
      if (bx.x0 < -EPS || bx.y0 < -EPS || bx.x1 > L + EPS || bx.y1 > W + EPS) {
        flags.push({ code: "cavity_outside", message: `${name} runs past the edge of the ${inch(L)} × ${inch(W)} part.` });
        return;
      }
      if (minWall > 0) {
        const edge = Math.min(bx.x0, bx.y0, L - bx.x1, W - bx.y1);
        if (edge < minWall - 1e-6) {
          flags.push({
            code: "thin_wall",
            message: `${name} leaves ${inch(Math.max(edge, 0))} of foam at the edge (shop minimum ${inch(minWall)}).`,
          });
        }
      }
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const g = gap(boxes[i], boxes[j]);
        if (g < -EPS) {
          flags.push({ code: "cavity_overlap", message: `${boxes[i].name} and ${boxes[j].name} overlap.` });
        } else if (minWall > 0 && g < minWall - 1e-6) {
          flags.push({
            code: "thin_wall",
            message: `${boxes[i].name} and ${boxes[j].name} are only ${inch(Math.max(g, 0))} apart (shop minimum ${inch(minWall)}).`,
          });
        }
      }
    }
  });

  // Largest block / bun the shop can cut from (either way round on L × W).
  const maxL = n(args.settings.foam_max_block_l_in);
  const maxW = n(args.settings.foam_max_block_w_in);
  const maxT = n(args.settings.foam_max_block_t_in);
  if (maxL > 0 && maxW > 0) {
    const [a, b] = [Math.max(L, W), Math.min(L, W)];
    const [ma, mb] = [Math.max(maxL, maxW), Math.min(maxL, maxW)];
    if (a > ma + EPS || b > mb + EPS) {
      flags.push({
        code: "oversize",
        message: `The ${inch(L)} × ${inch(W)} part is bigger than the largest block (${inch(maxL)} × ${inch(maxW)}).`,
      });
    }
  }
  if (maxT > 0) {
    const thick = layers.length > 0 ? layers.map((ly) => n(ly.thicknessIn)) : [H];
    thick.forEach((tk, i) => {
      if (tk > maxT + EPS) {
        flags.push({
          code: "oversize",
          message: `${layers.length > 1 ? `Layer ${i + 1}` : "The part"} is ${inch(tk)} thick; the thickest block is ${inch(maxT)}.`,
        });
      }
    });
  }

  // Complete pack: does the foam fit the box?
  if (args.completePack && Array.isArray(args.boxes)) {
    for (const bx of args.boxes) {
      if (!(bx.L > 0 && bx.W > 0 && bx.H > 0)) continue;
      const label = bx.label ? ` (${bx.label})` : "";
      const fits = (L <= bx.L + EPS && W <= bx.W + EPS) || (L <= bx.W + EPS && W <= bx.L + EPS);
      if (!fits) {
        flags.push({
          code: "box_too_small",
          message: `The ${inch(L)} × ${inch(W)} foam doesn't fit inside the ${inch(bx.L)} × ${inch(bx.W)} box${label}.`,
        });
      }
      if (H > bx.H + EPS) {
        flags.push({
          code: "box_too_shallow",
          message: `The foam stack is ${inch(H)} tall but the box${label} is only ${inch(bx.H)} deep.`,
        });
      }
    }
  }

  if (args.materialUnpriced) {
    flags.push({
      code: "material_unpriced",
      message: "The material has no price, so the foam was priced at the shop's default rate. Set its price on Materials, then reprice.",
    });
  }

  return flags;
}
