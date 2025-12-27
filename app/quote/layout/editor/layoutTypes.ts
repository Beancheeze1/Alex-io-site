// app/quote/layout/editor/layoutTypes.ts
//
// Core types + helpers for the quote layout editor.
// SAFE module — no React imports. Path A only.
//

export type BlockCornerStyle = "square" | "chamfer";

export type BlockDims = {
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;

  // NEW (Path A, additive):
  // Persist block-corner intent so exports can match the editor.
  // - If omitted, behavior is identical to today (square block).
  cornerStyle?: BlockCornerStyle;

  // When cornerStyle === "chamfer", the chamfer run (inches) for the 45° cut.
  // Example: 1 means a 1" run on both X and Y.
  chamferIn?: number;
};

export type CavityShape = "rect" | "circle" | "roundedRect";

export type Cavity = {
  id: string;
  label: string; // "3×2×1 in"
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

/**
 * A single foam layer in a multi-layer stack.
 *
 * NOTE (Path A):
 * - This is additive; existing single-layer flows that only use
 *   LayoutModel.cavities remain valid.
 * - Multi-layer layouts will populate `stack`, and each layer has its own
 *   cavities array.
 */
export type LayoutLayer = {
  id: string;
  label: string;
  thicknessIn: number;
  cavities: Cavity[];

  // NEW (Path A, additive):
  // Per-layer toggle for cropped/chamfered outside corners in exports/preview.
  // - If omitted or false, layer renders with square corners (current behavior).
  // - UI will manage this flag; we do NOT parse it from email.
  cropCorners?: boolean;
};

export type LayoutModel = {
  
  /**
   * Editor mode for the layout editor UI.
   *
   * - Optional for backward compatibility with previously saved layouts.
   * - When missing, treat as "basic".
   * - Persistence-only for now; MUST NOT change behavior yet.
   */
  editorMode?: "basic" | "advanced";
block: BlockDims;

  /**
   * Legacy single-layer cavities.
   *
   * - Existing editor code and older layouts rely on this.
   * - For new multi-layer behavior, this can represent the "active" layer’s
   *   cavities, while the full stack lives in `stack`.
   */
  cavities: Cavity[];

  /**
   * Optional multi-layer stack.
   *
   * - When present, this is the source of truth for all layers.
   * - `block` is shared for the whole stack.
   * - Backend app/api/quote/layout/apply/route.ts is already aware of this
   *   shape and will flatten stack[].cavities when needed.
   */
  stack?: LayoutLayer[];
};

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
    // cornerStyle/chamferIn intentionally NOT set here (defaults to square behavior)
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
 *
 * NOTE (Path A):
 * - For now, this seeds a legacy single-layer LayoutModel (block + cavities).
 * - Multi-layer stacks (`stack`) will be managed by the editor state and
 *   backend; no behavior change here.
 */
export function buildLayoutFromStrings(
  blockDims: string,
  cavitySpecs: string | null | undefined,
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
