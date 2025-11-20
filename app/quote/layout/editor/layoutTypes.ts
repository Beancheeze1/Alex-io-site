// app/quote/layout/editor/layoutTypes.ts
//
// Core types + helpers for the quote layout editor.
// Safe, standalone module — no React imports.

export type BlockDims = {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
};

export type CavityShape = "rect" | "circle" | "roundRect";

export type Cavity = {
  id: string;
  label: string; // e.g. "3×2×1 in"
  shape: CavityShape;
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  cornerRadiusIn?: number;
  // Normalized 0–1 coordinates inside the block footprint:
  x: number; // left
  y: number; // top
};

export type LayoutModel = {
  block: BlockDims;
  cavities: Cavity[];
};

// Global layout rules
export const SNAP_IN = 0.125; // 1/8"
export const WALL_MARGIN_IN = 0.5; // keep-out wall all around

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

export function snapInches(v: number): number {
  if (!Number.isFinite(v)) return SNAP_IN;
  return Math.max(SNAP_IN, Math.round(v / SNAP_IN) * SNAP_IN);
}

/**
 * Parse a "10x8x2" style string into BlockDims.
 */
export function parseBlockDims(dims: string): BlockDims | null {
  if (!dims) return null;
  const parts = dims
    .toLowerCase()
    .replace(/["\s]/g, "")
    .split("x");

  if (parts.length < 3) return null;
  const [l, w, t] = parts.map((p) => Number(p));
  if (!l || !w || !t) return null;

  return {
    lengthIn: l,
    widthIn: w,
    thicknessIn: t,
  };
}

/**
 * Parse cavity strings like:
 *   "3x2x1" or '3x2x1:deep'
 * into Cavity objects. `index` is used to stagger them.
 */
export function parseCavity(spec: string, index: number): Cavity | null {
  if (!spec) return null;

  const [dimsPart, labelPart] = spec.split(":");
  const parts = dimsPart
    .toLowerCase()
    .replace(/["\s]/g, "")
    .split("x");

  if (parts.length < 3) return null;

  const [l, w, d] = parts.map((p) => Number(p));
  if (!l || !w || !d) return null;

  const lengthIn = snapInches(l);
  const widthIn = snapInches(w);
  const depthIn = snapInches(d);

  // Simple staggered positions to avoid overlap (0–1 space).
  const col = index % 3;
  const row = Math.floor(index / 3);
  const x = 0.1 + col * 0.25;
  const y = 0.1 + row * 0.25;

  const baseLabel = `${lengthIn}×${widthIn}×${depthIn} in`;
  const prettyLabel = labelPart
    ? `${baseLabel} (${labelPart.trim()})`
    : baseLabel;

  return {
    id: `cav-${index}`,
    label: prettyLabel,
    shape: "rect",
    lengthIn,
    widthIn,
    depthIn,
    cornerRadiusIn: 0.25,
    x,
    y,
  };
}

/**
 * Build a LayoutModel from a "10x8x2" block string and
 * semicolon-separated cavity strings like "3x2x1;2x2x1".
 */
export function buildLayoutFromStrings(
  blockDims: string,
  cavitySpecs: string | null | undefined
): LayoutModel | null {
  const block = parseBlockDims(blockDims);
  if (!block) return null;

  const cavities: Cavity[] = [];
  if (cavitySpecs) {
    const parts = cavitySpecs
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    parts.forEach((p, idx) => {
      const cav = parseCavity(p, idx);
      if (cav) cavities.push(cav);
    });
  }

  return { block, cavities };
}

/**
 * Clamp a cavity's x/y so it stays inside the inner wall margin.
 * Inputs and outputs are normalized 0–1.
 */
export function clampCavityPosition(
  cav: Cavity,
  block: BlockDims,
  xNorm: number,
  yNorm: number
): { x: number; y: number } {
  const { lengthIn, widthIn } = cav;
  const { lengthIn: BL, widthIn: BW } = block;

  if (!BL || !BW) return { x: 0, y: 0 };

  const cavLenNorm = lengthIn / BL;
  const cavWidNorm = widthIn / BW;

  const minX = WALL_MARGIN_IN / BL;
  const minY = WALL_MARGIN_IN / BW;
  const maxX = 1 - WALL_MARGIN_IN / BL - cavLenNorm;
  const maxY = 1 - WALL_MARGIN_IN / BW - cavWidNorm;

  return {
    x: clamp(xNorm, minX, maxX),
    y: clamp(yNorm, minY, maxY),
  };
}

/**
 * Clamp a cavity's size so it fits inside the inner wall.
 */
export function clampCavitySize(
  cav: Cavity,
  block: BlockDims,
  newLengthIn: number,
  newWidthIn: number
): { lengthIn: number; widthIn: number } {
  const { lengthIn: BL, widthIn: BW } = block;

  let L = snapInches(newLengthIn);
  let W = snapInches(newWidthIn);

  const maxL = Math.max(SNAP_IN, BL - 2 * WALL_MARGIN_IN);
  const maxW = Math.max(SNAP_IN, BW - 2 * WALL_MARGIN_IN);

  L = clamp(L, SNAP_IN, maxL);
  W = clamp(W, SNAP_IN, maxW);

  return { lengthIn: L, widthIn: W };
}
