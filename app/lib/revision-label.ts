// app/lib/revision-label.ts
//
// Shared logic for turning a quote's raw revision "facts" (Redis-backed,
// see app/lib/memory.ts) into the label that's safe to display.
//
// THE INVARIANT this exists to enforce:
//   - A released/locked quote must show a single letter only (A, B, C...) --
//     never a trailing "S".
//   - A quote still in staging (not locked) must show letter+S (AS, BS,
//     CS...).
//   - A quote can never be both "locked" and show a trailing "S" -- if you
//     see both, something read the wrong field.
//
// WHY this needs its own function instead of just reading facts.revision:
// facts.revision is the raw internal staging/mint WORKING value. It can
// legitimately still hold an "S"-suffixed label even once a quote is
// locked -- e.g. in the moment right after release, before the next Apply
// bumps anything -- because release only overwrites facts.released_rev (and
// mirrors it into facts.revision) as a separate, non-fatal, best-effort
// step (see the "RELEASED REV MINT" block in
// app/api/admin/quotes/lock/route.ts). Reading facts.revision directly,
// without ever checking the quote's locked status, is what let a released
// quote display e.g. "BS" alongside a package tagged [REV:...] RELEASED.
//
// This mirrors pickDisplayRevision() in app/api/quote/print/route.ts
// (kept there, untouched, as the original correct implementation) so every
// other place that shows a revision label -- the admin quotes list, the
// admin quote detail page, the customer/staff quote viewer -- enforces the
// same invariant instead of re-deriving it (and re-forgetting the locked
// check) a third and fourth time.

export type RevisionFacts = {
  revision?: string | null;
  stage_rev?: string | null;
  released_rev?: string | null;
} | null | undefined;

export function normalizeRevLabel(s?: string | null): string {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.toLowerCase().startsWith("rev") ? t.slice(3).trim() : t;
}

/**
 * The revision label safe to display for a quote, given its current facts
 * and locked status. Locked quotes never show a trailing "S"; unlocked
 * quotes always do (defaulting to "AS" for a quote with no revision history
 * yet).
 */
export function displayRevisionLabel(facts: RevisionFacts, locked: boolean): string {
  if (locked) {
    const r = normalizeRevLabel(facts?.released_rev || facts?.revision || "");
    return r && !r.endsWith("S") ? r : r.replace(/S$/i, "");
  }
  const s = normalizeRevLabel(facts?.stage_rev || facts?.revision || "");
  return s || "AS";
}
