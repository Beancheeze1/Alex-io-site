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

/**
 * Step 39K: the next staging label from the highest staging label reached:
 * "" -> "AS", "AS" -> "BS", "BS" -> "CS"; a bare released letter "B" -> "BS".
 * (Same rule as nextStageRev in app/api/quote/layout/apply/route.ts.)
 */
export function nextStageLabel(cur?: string | null): string {
  const t = normalizeRevLabel(cur);
  if (!t) return "AS";
  const c = t.charAt(0).toUpperCase();
  const code = c.charCodeAt(0);
  if (code < 65 || code > 90) return "AS";
  if (t.length >= 2 && t.charAt(1).toUpperCase() === "S") return code >= 90 ? "ZS" : String.fromCharCode(code + 1) + "S";
  return c + "S";
}

/**
 * Step 39K: Revise on a released quote opens the NEXT staging revision right
 * away (e.g. AS -> released A -> Revise -> BS), so the quote never shows the
 * old staging letter again. A boxes-only quote has no layout Apply to bump it,
 * so before this it stayed on its first staging letter forever. The new
 * letter is marked fresh: the first layout Apply after the Revise uses it
 * instead of bumping again (later Applies bump as before).
 */
export function revisedFacts<T extends Record<string, unknown>>(facts: T | null | undefined): T & { stage_rev: string; revision: string; stage_fresh: true } {
  const f = (facts || {}) as T;
  const cur = (f as { stage_rev?: string | null; revision?: string | null }).stage_rev || null;
  const next = nextStageLabel(cur || "AS");
  return { ...f, stage_rev: next, revision: next, stage_fresh: true };
}
