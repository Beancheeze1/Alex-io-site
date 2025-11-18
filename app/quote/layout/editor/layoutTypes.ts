// app/quote/layout/editor/layoutTypes.ts
//
// Core types + helpers for the quote layout editor.
// Safe, standalone module — no React imports.

export type BlockDims = {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
};

export type Cavity = {
  id: string;
  label: string; // e.g. "3×2×1 in"
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  // Normalized 0–1 coordinates inside the block footprint (top-left origin):
  x: number; // left
  y: number; // top
};

export type LayoutModel = {
  block: BlockDims;
  cavities: Cavity[];
};

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

  // Simple staggered positions to avoid overlap (0–1 space).
  const col = index % 3;
  const row = Math.floor(index / 3);
  const x = 0.1 + col * 0.25;
  const y = 0.1 + row * 0.25;

  const baseLabel = `${l}×${w}×${d} in`;
  const prettyLabel = labelPart
    ? `${baseLabel} (${labelPart.trim()})`
    : baseLabel;

  return {
    id: `cav-${index}`,
    label: prettyLabel,
    lengthIn: l,
    widthIn: w,
    depthIn: d,
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
