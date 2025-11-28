// app/quote/layout/editor/layoutTypes.ts
//
// Core types + helpers for the quote layout editor.
// SAFE module — no React imports. Path A only.
//

export type BlockDims = {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
};

export type CavityShape = "rect" | "circle" | "roundedRect";

export type Cavity = {
  id: string;
  label: string;        // "3×2×1 in"
  shape: CavityShape;
  cornerRadiusIn: number;
  lengthIn: number;
  widthIn: number;
  depthIn: number;

  // IMPORTANT:
  // These will be assigned later by page.tsx grid placement.
  x: number;
  y: number;
};

export type LayoutModel = {
  block: BlockDims;
  cavities: Cavity[];
};

/** Format human-readable cavity label */
/**
 * Format a label for a cavity, based on its dimensions + shape.
 * - Keeps decimals like .5 instead of rounding to whole inches.
 * - Strips trailing zeros (1.50 -> 1.5, 1.00 -> 1).
 * - Uses ".5" style for values between 0 and 1.
 */
export function formatCavityLabel(
  c: Pick<Cavity, "shape" | "lengthIn" | "widthIn" | "depthIn">,
): string {
  const fmt = (n: number): string => {
    if (!Number.isFinite(n)) return "?";

    // Round to 3 decimal places to avoid float junk
    const rounded = Math.round(n * 1000) / 1000;

    // Format with up to 3 decimals, then strip trailing zeros
    let s = rounded.toFixed(3).replace(/\.?0+$/, "");

    // Turn "0.5" into ".5" for nicer foam-style dimensions
    s = s.replace(/^0\./, ".");

    return s;
  };

  const L = fmt(c.lengthIn);
  const W = fmt(c.widthIn);
  const D = fmt(c.depthIn);

  if (c.shape === "circle") {
    // Ø6 × .5 in
    return `Ø${L} × ${D} in`;
  }

  // 1 × 1 × .5 in
  return `${L} × ${W} × ${D} in`;
}


/** Extract numbers from a string */
function extractNums(input: string | null | undefined): number[] {
  if (!input) return [];
  const cleaned = String(input).toLowerCase();
  const matches = cleaned.match(/(\d*\.?\d+)/g);
  if (!matches) return [];
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}

/** Parse block dims "10x8x2" */
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
 * Parse a cavity specification into dims ONLY.
 * DO NOT assign x/y. Page.tsx will handle positioning.
 */
export function parseCavity(spec: string, index: number): Cavity | null {
  if (!spec) return null;

  const [dimsPart, labelPart] = spec.split(":");
  const nums = extractNums(dimsPart);
  if (nums.length < 3) return null;

  const [l, w, d] = nums;
  if (![l, w, d].every((n) => n > 0)) return null;

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
    id: `cav-${index + 1}`,
    label: prettyLabel,
    shape: "rect",
    cornerRadiusIn: 0,
    lengthIn: l,
    widthIn: w,
    depthIn: d,

    // PLACEHOLDERS — real placement done later
    x: 0,
    y: 0,
  };
}

/**
 * Build LayoutModel from block + cavity strings.
 * This version returns clean dims only.
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
