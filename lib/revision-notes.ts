// lib/revision-notes.ts
//
// Step 44d: the description and "revised by" initials staff enter when they
// Revise a quote. They go in the revision block on the 3-view PDF drawings.
// Saved in the quote's facts as rev_notes[letter], keyed by the revision
// letter the next layout Apply will carry (see upcomingStageLetter). Pure and
// client-safe: the Revise box, the API route and the drawing all use these.

import { nextStageLabel, normalizeRevLabel } from "@/app/lib/revision-label";

export const REV_DESC_MAX = 60; // about 40 characters fit on the drawing; longer ones end in "…"
export const REV_BY_MAX = 4;

export type RevisionNote = { description: string; by: string; at?: string; user_id?: number | null };
export type RevisionNotes = Record<string, RevisionNote>;

/** "Chuck Jones" -> "CJ"; "ashtonne" -> "AS"; no name -> the email's first two letters; nothing -> "". */
export function initialsOf(u: { name?: string | null; email?: string | null } | null | undefined): string {
  if (!u) return "";
  const words = String(u.name || "")
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();
  const local = String(u.email || "").split("@")[0].replace(/[^a-z]/gi, "");
  return local.slice(0, 2).toUpperCase();
}

/** One line, plain text, trimmed to REV_DESC_MAX. */
export function cleanRevDescription(v: unknown): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REV_DESC_MAX);
}

/** Letters only, upper case, up to REV_BY_MAX. */
export function cleanRevBy(v: unknown): string {
  return String(v ?? "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase()
    .slice(0, REV_BY_MAX);
}

/**
 * The staging letter the quote's next layout Apply will carry: the letter a
 * Revise just opened (stage_fresh), else the next one after the highest
 * staging letter reached (same rule as the Apply route's bump).
 */
export function upcomingStageLetter(facts: Record<string, unknown> | null | undefined): string {
  const stage = normalizeRevLabel(typeof facts?.stage_rev === "string" ? facts.stage_rev : "");
  if (facts?.stage_fresh === true && stage) return stage.toUpperCase();
  return nextStageLabel(stage || null);
}

/** The saved notes from facts (anything malformed is skipped). */
export function revisionNotesOf(facts: Record<string, unknown> | null | undefined): RevisionNotes {
  const raw = facts?.rev_notes;
  const out: RevisionNotes = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const description = cleanRevDescription(o.description);
    const by = cleanRevBy(o.by);
    if (!description && !by) continue;
    out[k.toUpperCase()] = {
      description,
      by,
      at: typeof o.at === "string" ? o.at : undefined,
      user_id: Number.isFinite(Number(o.user_id)) ? Number(o.user_id) : null,
    };
  }
  return out;
}

/** facts.rev_notes with this letter's note set (keeps the newest 50 letters). */
export function withRevisionNote(facts: Record<string, unknown>, letter: string, note: RevisionNote): Record<string, unknown> {
  const notes = revisionNotesOf(facts);
  notes[letter.toUpperCase()] = note;
  const keys = Object.keys(notes);
  const kept = keys.slice(Math.max(0, keys.length - 50));
  return { ...facts, rev_notes: Object.fromEntries(kept.map((k) => [k, notes[k]])) };
}
