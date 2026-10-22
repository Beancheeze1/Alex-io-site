// lib/box-styles.ts
//
// Step 27: the corrugated styles Alex-IO quotes (pure: safe in the browser).
// One list for every picker, route and the pricing engine.
//
//   rsc        regular slotted container (shipper)              slotted
//   hsc        half slotted: one set of flaps, open top          slotted
//   fol        full overlap: flaps the full width                slotted
//   mailer     die-cut roll-end tuck-front mailer (FEFCO 0427)   die-cut
//   tray       die-cut 4-wall tray, open top                     die-cut
//   pad        flat pad / sheet, L x W (no depth)                flat
//   partition  slotted partition set: cells across x down, height = depth
//
// Die-cut styles carry a one-time cutting die when run on the press (not on
// digital short runs, which are CAD cut). Partitions are unprinted.
//
// Step 39C: "dieline" = a die-cut box measured from the buyer's / shop's own
// die line file (blank size and rule inches from the file). It is never in
// the pickers (BOX_STYLES); it only comes from a file upload.

export type BoxStyle = "rsc" | "hsc" | "fol" | "mailer" | "tray" | "pad" | "partition" | "dieline";

export type BoxStyleKind = "slotted" | "diecut" | "flat" | "partition";

export type BoxStyleInfo = {
  key: BoxStyle;
  label: string; // picker label
  desc: string; // one line for pickers
  kind: BoxStyleKind;
  usesDepth: boolean; // pads have no depth
  depthLabel: string; // "Depth" / "Height"
  cells: boolean; // partitions ask cells across x down
  printable: boolean;
  forFoam: boolean; // offered as the box around foam (complete pack)
};

export const BOX_STYLES: BoxStyleInfo[] = [
  { key: "rsc", label: "RSC / shipper", desc: "Regular slotted container. Tape-sealed shipping box.", kind: "slotted", usesDepth: true, depthLabel: "Depth", cells: false, printable: true, forFoam: true },
  { key: "hsc", label: "HSC (open top)", desc: "Half slotted: bottom flaps only, open top.", kind: "slotted", usesDepth: true, depthLabel: "Depth", cells: false, printable: true, forFoam: true },
  { key: "fol", label: "FOL (full overlap)", desc: "Flaps the full width of the box, for extra strength.", kind: "slotted", usesDepth: true, depthLabel: "Depth", cells: false, printable: true, forFoam: true },
  { key: "mailer", label: "Mailer box", desc: "Die-cut roll-end tuck-front mailer. No tape needed.", kind: "diecut", usesDepth: true, depthLabel: "Depth", cells: false, printable: true, forFoam: true },
  { key: "tray", label: "Die-cut tray", desc: "Four-wall open-top tray with locking corners.", kind: "diecut", usesDepth: true, depthLabel: "Depth", cells: false, printable: true, forFoam: true },
  { key: "pad", label: "Pad / sheet", desc: "Flat corrugated pad, length x width.", kind: "flat", usesDepth: false, depthLabel: "Depth", cells: false, printable: true, forFoam: false },
  { key: "partition", label: "Partition set", desc: "Slotted dividers: cells across x down, height = depth.", kind: "partition", usesDepth: true, depthLabel: "Height", cells: true, printable: false, forFoam: false },
];

export const BOX_STYLE_KEYS: BoxStyle[] = BOX_STYLES.map((s) => s.key);

/** Step 39C: the from-a-file die-cut style (not offered in pickers). */
export const DIELINE_STYLE: BoxStyleInfo = {
  key: "dieline",
  label: "Die-cut from your file",
  desc: "Priced from an uploaded die line: blank size and rule from the file.",
  kind: "diecut",
  usesDepth: false,
  depthLabel: "Depth",
  cells: false,
  printable: true,
  forFoam: false,
};

/** A style key from user / stored input; anything containing "mailer" is a mailer. Unknown -> null. */
export function parseBoxStyle(raw: unknown): BoxStyle | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const hit = BOX_STYLES.find((x) => x.key === s);
  if (hit) return hit.key;
  if (s === "dieline") return "dieline"; // Step 39C
  if (s.includes("mailer")) return "mailer";
  return null;
}

/** parseBoxStyle with RSC as the fallback (old rows and inputs). */
export function boxStyleOrRsc(raw: unknown): BoxStyle {
  return parseBoxStyle(raw) ?? "rsc";
}

export function boxStyleInfo(style: BoxStyle): BoxStyleInfo {
  if (style === "dieline") return DIELINE_STYLE; // Step 39C
  return BOX_STYLES.find((s) => s.key === style) ?? BOX_STYLES[0];
}

export function boxStyleLabel(raw: unknown): string {
  const s = parseBoxStyle(raw);
  return s ? boxStyleInfo(s).label : String(raw ?? "").toUpperCase();
}

export type PartitionCells = { across: number; down: number };

export const MAX_CELLS = 20;

/** Cells for a partition set: whole numbers 1..20 each, at least 2 cells. Else null. */
export function parseCells(across: unknown, down: unknown): PartitionCells | null {
  const a = Number(across);
  const d = Number(down);
  if (!Number.isInteger(a) || !Number.isInteger(d)) return null;
  if (a < 1 || d < 1 || a > MAX_CELLS || d > MAX_CELLS) return null;
  if (a * d < 2) return null;
  return { across: a, down: d };
}

/** "Custom box 12 x 10 x 8 in" / "Custom pad 12 x 10 in" / "Custom partition set 12 x 10 x 6 in, 3 x 4 cells". */
export function customBoxBaseDesc(style: BoxStyle | null, L: number, W: number, H: number, cells?: PartitionCells | null): string {
  if (style === "pad") return `Custom pad ${L} x ${W} in`;
  if (style === "dieline") return `Die-cut box from your file, ${L} x ${W} in blank`; // Step 39C
  if (style === "partition") {
    return `Custom partition set ${L} x ${W} x ${H} in${cells ? `, ${cells.across} x ${cells.down} cells` : ""}`;
  }
  return `Custom box ${L} x ${W} x ${H} in`;
}

export type CustomBoxInput = {
  L: number;
  W: number;
  D: number; // 0 for pads
  style: BoxStyle;
  cells: PartitionCells | null;
};

/**
 * Step 27: a typed custom box from a request body: { L, W, D, style,
 * cells_across?, cells_down? }. A missing or unknown style is RSC (old
 * callers). Pads ignore D (stored as 0); partitions need cells.
 */
export function parseCustomBoxInput(
  raw: Record<string, unknown>,
): { ok: true; value: CustomBoxInput } | { ok: false; message: string } {
  const style = boxStyleOrRsc(raw.style);
  // Step 39C: a die line is priced from its file, never from typed sizes.
  if (style === "dieline") return { ok: false, message: "Upload the die line file to quote a box from it." };
  const info = boxStyleInfo(style);
  const L = Number(raw.L);
  const W = Number(raw.W);
  const D = info.usesDepth ? Number(raw.D) : 0;
  const okDim = (n: number) => Number.isFinite(n) && n > 0 && n <= 1000;
  if (!okDim(L) || !okDim(W) || (info.usesDepth && !okDim(D))) {
    return {
      ok: false,
      message: info.usesDepth
        ? `Enter the inside length, width and ${info.depthLabel.toLowerCase()}.`
        : "Enter the length and width.",
    };
  }
  let cells: PartitionCells | null = null;
  if (info.cells) {
    cells = parseCells(raw.cells_across, raw.cells_down);
    if (!cells) {
      return { ok: false, message: `Enter the partition cells across and down (whole numbers 1-${MAX_CELLS}, at least 2 cells).` };
    }
  }
  return { ok: true, value: { L, W, D, style, cells } };
}
