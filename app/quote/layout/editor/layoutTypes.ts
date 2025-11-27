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
export function formatCavityLabel(
  c: Pick<Cavity, "shape" | "lengthIn" | "widthIn" | "depthIn">
): string {
  if (c.shape === "circle") {
    return `Ø${c.lengthIn}×${c.depthIn} in`;
  }
  return `${c.lengthIn}×${c.widthIn}×${c.depthIn} in`;
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
