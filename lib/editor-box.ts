// lib/editor-box.ts
//
// Step 44g: the carton the layout editor sends with Apply when the
// "Customer box (inside)" size is filled in. Pure (tested in
// scripts/test-editor-box.ts).

export type EditorCustomerBox = { L: number; W: number; H: number; style?: "mailer" | "rsc" };

export type EditorCarton = {
  style?: string;
  sku?: string;
  board_grade_id?: number | null;
  inside_length_in?: number;
  inside_width_in?: number;
  inside_height_in?: number;
  [k: string]: unknown;
};

/**
 * The carton to send, given the customer box and the carton the editor would
 * otherwise send (from the Start Quote URL or a stock pick).
 * - A stock box picked this session ("Stock sizes that fit") wins.
 * - No (complete) customer box: the other carton, unchanged.
 * - The customer box at the same size and style: the other carton, unchanged
 *   (a stock SKU from Start Quote stays stock).
 * - Otherwise: a custom box at the customer box size. editor_box is true when
 *   the editor wasn't opened from Start Quote (the server then only uses it on
 *   a quote that already has a box).
 */
export function editorCarton(
  box: EditorCustomerBox | null | undefined,
  other: EditorCarton | null | undefined,
  opts: { fromStartQuote: boolean; stockPickedThisSession: boolean },
): EditorCarton | null {
  const keep = other ?? null;
  if (opts.stockPickedThisSession && !opts.fromStartQuote && keep) return keep;
  if (!box || !(box.L > 0 && box.W > 0 && box.H > 0)) return keep;
  const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.005;
  const sameSize = !!keep && near(keep.inside_length_in, box.L) && near(keep.inside_width_in, box.W) && near(keep.inside_height_in, box.H);
  const sameStyle = !box.style || !keep?.style || String(keep.style).toLowerCase() === box.style;
  if (sameSize && sameStyle) return keep;
  return {
    style: box.style ?? (keep?.style ? String(keep.style) : ""),
    sku: `CUSTOM-${box.L}x${box.W}x${box.H}`,
    description: `Custom ${box.L}×${box.W}×${box.H} in`,
    board_grade_id: keep?.board_grade_id ?? null,
    inside_length_in: box.L,
    inside_width_in: box.W,
    inside_height_in: box.H,
    fit_score: 0,
    notes: null,
    editor_box: !opts.fromStartQuote,
  };
}
