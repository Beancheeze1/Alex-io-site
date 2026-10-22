// lib/box-shape.ts
//
// Step 39B: catch box sizes that are almost certainly typed in the wrong
// order before they turn into a huge price. Mailers and trays are shallow:
// when the depth is more than the width, the blank grows fast (a mailer's
// end walls fold double), e.g. a "12 x 4 x 16" mailer is a 76 3/4 x 59 1/8
// blank. Pure (no DB): used by the quote forms (a hint with a one-click
// fix) and by box pricing (the line is flagged Needs review for staff).

import type { BoxStyle } from "@/lib/box-styles";

export type BoxShapeIssue = {
  code: "deeper_than_wide";
  message: string; // staff / buyer text
  suggestion: { L: number; W: number; D: number }; // largest first: length, width, depth
};

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** null when the size looks normal for the style. */
export function boxShapeIssue(style: BoxStyle | string | null | undefined, dims: { L: number; W: number; D: number }): BoxShapeIssue | null {
  const s = String(style || "").toLowerCase();
  if (s !== "mailer" && s !== "tray") return null;
  const { L, W, D } = dims;
  if (![L, W, D].every((n) => Number.isFinite(n) && n > 0)) return null;
  if (!(D > W)) return null;
  const [a, b, c] = [L, W, D].sort((x, y) => y - x);
  const kind = s === "mailer" ? "Mailers" : "Trays";
  return {
    code: "deeper_than_wide",
    message: `${kind} are usually shallow, but this one is ${fmt(D)}" deep and ${fmt(W)}" wide (${fmt(L)} × ${fmt(W)} × ${fmt(D)}). Did you mean ${fmt(a)} × ${fmt(b)} × ${fmt(c)}?`,
    suggestion: { L: a, W: b, D: c },
  };
}
