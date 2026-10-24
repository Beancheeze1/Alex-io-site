// app/lib/internal-notes-core.ts
//
// Step 39V: staff add a dated, signed line to a quote's internal notes from
// the quotes list or the admin quote page. Nothing earlier is changed.
// Pure; tested in scripts/test-internal-notes.ts.

export const NOTE_MAX = 1000;
export const NOTES_MAX = 20000;

/** The note text as typed: trimmed, inner whitespace kept, at most NOTE_MAX characters, or null when empty. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\r\n?/g, "\n").trim();
  if (!t) return null;
  return t.slice(0, NOTE_MAX);
}

/** "Oct 24, 2026 – Chuck Admin: text" (the date in the shop's time zone). */
export function noteLine(text: string, author: string | null, at: Date, timeZone = "America/New_York"): string {
  let day: string;
  try {
    day = at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
  } catch {
    day = at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  const who = (author || "").trim() || "Staff";
  return `${day} – ${who}: ${text}`;
}

/** The notes with the new line added at the end (kept under NOTES_MAX by dropping the oldest text). */
export function appendNote(existing: string | null | undefined, line: string): string {
  const prev = typeof existing === "string" ? existing.replace(/\s+$/, "") : "";
  const next = prev ? `${prev}\n${line}` : line;
  return next.length > NOTES_MAX ? next.slice(next.length - NOTES_MAX) : next;
}
