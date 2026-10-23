// app/lib/foam-terms.ts
//
// Step 39N: the words staff and buyers see for a foam job (pure, browser-safe).
//   Set         everything for one unit of the customer's product (the qty)
//   Part        one finished, separate piece of the set: an entry of the
//               layout's `stack` (Bottom Insert, Top Pad, a die-cut part)
//   Layer       a sheet of foam laminated into a part (withSheets)
//   Stock sheet the raw sheet a layer is cut from
// The saved data keeps its names (layout `stack`, "Layer N" default labels,
// [LAYOUT-LAYER] markers, layer_* parameters); only what's shown changes.

const DEFAULT_NAME = /^(layer|part)\s*#?\s*\d+$/i;

/** The part's own name, or null when it's only the default ("Layer 2" / "Part 2"). */
export function partCustomName(label: unknown): string | null {
  const s = typeof label === "string" ? label.trim() : "";
  return s && !DEFAULT_NAME.test(s) ? s : null;
}

/** "Part 2" (index is 0-based). */
export function partTitle(index: number): string {
  return `Part ${index + 1}`;
}

/** "Part 2 Top Pad", or "Part 2" when it has no name of its own. */
export function partName(label: unknown, index: number): string {
  const own = partCustomName(label);
  return own ? `${partTitle(index)} ${own}` : partTitle(index);
}

/** "1 part" / "3 parts", "1 layer" / "4 layers" … */
export function count(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** A saved part name as shown: "Layer 2" (the old default) reads "Part 2"; other names are kept. */
export function partLabelShown(label: unknown): string {
  const s = typeof label === "string" ? label.trim() : "";
  const m = /^layer\s*#?\s*(\d+)$/i.exec(s);
  return m ? `Part ${m[1]}` : s;
}
