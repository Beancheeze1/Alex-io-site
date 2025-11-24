// app/quote/layout/editor/layoutTypes.ts
//
// Core types + helpers for the quote layout editor.
// Safe, standalone module — no React imports.

export type BlockDims = {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
};

export type CavityShape = "rect" | "circle" | "roundedRect";

export type Cavity = {
  id: string;
  label: string; // human-readable label, e.g. "3×2×1 in"
  shape: CavityShape;
  cornerRadiusIn: number; // for roundedRect; 0 for rect/circle
  lengthIn: number;
  widthIn: number;
  depthIn: number;
  // Normalized 0–1 coordinates inside the block footprint:
  x: number; // left
  y: number; // top
};

export type LayoutModel = {
  block: BlockDims;
  cavities: Cavity[];
};

/**
 * Format a label for a cavity, based on its dimensions + shape.
 */
export function formatCavityLabel(
  c: Pick<Cavity, "shape" | "lengthIn" | "widthIn" | "depthIn">
): string {
  if (c.shape === "circle") {
    return `Ø${c.lengthIn}×${c.depthIn} in`;
  }
  return `${c.lengthIn}×${c.widthIn}×${c.depthIn} in`;
}

/**
 * Helper: pull numeric values (ints/decimals) out of a string.
 * Examples:
 *   "10x8x2"           -> ["10", "8", "2"]
 *   '1 x 1 x 0.5 in'   -> ["1", "1", "0.5"]
 *   '.5 x 1.25 x 2.0"' -> ["0.5", "1.25", "2.0"]
 */
function extractNums(input: string | null | undefined): number[] {
  if (!input) return [];
  const cleaned = String(input).toLowerCase();
  const matches = cleaned.match(/(\d*\.?\d+)/g); // allow "1", "1.5", ".5"
  if (!matches) return [];
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}

/**
 * Parse a "10x8x2" style string into BlockDims.
 * Now tolerant of units / spaces / quotes, e.g. "10 x 8 x 2 in".
 */
export function parseBlockDims(dims: string): BlockDims | null {
  const nums = extractNums(dims);
  if (nums.length < 3) return null;

  const [l, w, t] = nums;
  if (![l, w, t].every((n) => n > 0)) return null;

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
 *   "1 x 1 x 0.5 in:label"
 *
 * into Cavity objects. index is used to stagger them.
 * Shape defaults to "rect" and corner radius to 0.
 */
export function parseCavity(spec: string, index: number): Cavity | null {
  if (!spec) return null;

  const [dimsPart, labelPart] = spec.split(":");
  const nums = extractNums(dimsPart);
  if (nums.length < 3) return null;

  const [l, w, d] = nums;
  if (![l, w, d].every((n) => n > 0)) return null;

  // Simple staggered positions to avoid overlap (0–1 space).
  const col = index % 3;
  const row = Math.floor(index / 3);
  const x = 0.1 + col * 0.25;
  const y = 0.1 + row * 0.25;

  const baseLabel = formatCavityLabel({
    shape: "rect",
    lengthIn: l,
    widthIn: w,
    depthIn: d,
  });

  const prettyLabel = labelPart
    ? `${baseLabel} (${labelPart.trim()})`
    : baseLabel;

  return {
    id: `cav-${index}`,
    label: prettyLabel,
    shape: "rect",
    cornerRadiusIn: 0,
    lengthIn: l,
    widthIn: w,
    depthIn: d,
    x,
    y,
  };
}

/**
 * Build a LayoutModel from a "10x8x2" block string and
 * semicolon- or comma-separated cavity strings like:
 *   "3x2x1;2x2x1"
 *   "1 x 1 x 0.5 in; 2 x 2 x 1 in:label"
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
