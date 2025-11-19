// app/quote/layout/editor/layoutTypes.ts
//
// Core types + helpers for the quote layout editor.
// Safe, standalone module — no React imports.

export const WALL_MARGIN_IN = 0.5;   // keep 0.5" wall all around
export const SNAP_IN = 0.125;        // 1/8" snapping for sizes

export type BlockDims = {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
};

export type CavityShape = "rect" | "roundRect" | "circle";

export type Cavity = {
  id: string;
  label: string;          // e.g. "3×2×1 in"
  lengthIn: number;       // L in inches
  widthIn: number;        // W in inches
  depthIn: number;        // depth in inches (not drawn, but editable)
  shape: CavityShape;
  cornerRadiusIn: number; // in inches; used for roundRect. 0 for rect/circle.
  // Normalized 0–1 coordinates for TOP-LEFT of the cavity inside the block footprint
  x: number;
  y: number;
};

export type LayoutModel = {
  block: BlockDims;
  cavities: Cavity[];
};

// For creating new cavities from presets / palette
export type NewCavityInput = {
  label?: string;
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  shape?: CavityShape;
  cornerRadiusIn?: number;
};

/** Snap a value to 1/8" increments with a sensible minimum. */
export function snapInches(value: number): number {
  if (!Number.isFinite(value)) return SNAP_IN;
  const snapped = Math.round(value / SNAP_IN) * SNAP_IN;
  return Math.max(SNAP_IN, parseFloat(snapped.toFixed(3)));
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
 *   "3x2x1"
 *   "3x2x1:deep pocket"
 *   "3x2x1:round"
 *   "3x2x1:circle"
 */
export function parseCavity(spec: string, index: number): Cavity | null {
  if (!spec) return null;

  const [dimsPart, labelPartRaw] = spec.split(":");
  const parts = dimsPart
    .toLowerCase()
    .replace(/["\s]/g, "")
    .split("x");

  if (parts.length < 3) return null;

  const [l, w, d] = parts.map((p) => Number(p));
  if (!l || !w || !d) return null;

  let shape: CavityShape = "rect";
  let cornerRadiusIn = 0;

  const labelPart = labelPartRaw ? labelPartRaw.trim() : "";
  if (labelPart) {
    const lower = labelPart.toLowerCase();
    if (lower.includes("circle")) {
      shape = "circle";
    } else if (lower.includes("round")) {
      shape = "roundRect";
      cornerRadiusIn = 0.5;
    }
  }

  const baseLabel = `${l}×${w}×${d} in`;
  const prettyLabel = labelPart ? `${baseLabel} (${labelPart})` : baseLabel;

  // Simple staggered positions to avoid overlap (0–1 space).
  const col = index % 3;
  const row = Math.floor(index / 3);
  const x = 0.1 + col * 0.25;
  const y = 0.1 + row * 0.25;

  return {
    id: `cav-${index}`,
    label: prettyLabel,
    lengthIn: l,
    widthIn: w,
    depthIn: d,
    shape,
    cornerRadiusIn,
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
 * Ensure a cavity stays inside the block and respects the 0.5" wall margin.
 */
export function clampCavityToBlock(block: BlockDims, cav: Cavity): Cavity {
  const margin = WALL_MARGIN_IN;

  // Cap cavity size so it can't be larger than the interior.
  const maxLength = Math.max(0, block.lengthIn - margin * 2);
  const maxWidth = Math.max(0, block.widthIn - margin * 2);

  let lengthIn = Math.min(snapInches(cav.lengthIn), maxLength);
  let widthIn = Math.min(snapInches(cav.widthIn), maxWidth);

  if (lengthIn < SNAP_IN) lengthIn = SNAP_IN;
  if (widthIn < SNAP_IN) widthIn = SNAP_IN;

  // Convert normalized x,y -> absolute inches.
  let xAbs = cav.x * block.lengthIn;
  let yAbs = cav.y * block.widthIn;

  // Keep inside walls.
  if (xAbs < margin) xAbs = margin;
  if (yAbs < margin) yAbs = margin;

  if (xAbs + lengthIn > block.lengthIn - margin) {
    xAbs = block.lengthIn - margin - lengthIn;
  }
  if (yAbs + widthIn > block.widthIn - margin) {
    yAbs = block.widthIn - margin - widthIn;
  }

  // Back to normalized.
  const xNorm = block.lengthIn > 0 ? xAbs / block.lengthIn : 0;
  const yNorm = block.widthIn > 0 ? yAbs / block.widthIn : 0;

  return {
    ...cav,
    lengthIn,
    widthIn,
    x: xNorm,
    y: yNorm,
  };
}
