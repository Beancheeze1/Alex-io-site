// lib/project-name.ts
//
// Step 50: the optional project name on a quote. Pure (no DB); tested in
// scripts/test-project-name.ts. Saved by app/lib/project-name.ts.

export const PROJECT_NAME_MAX = 80;

/**
 * A typed project name, cleaned: control characters removed, spaces
 * collapsed, trimmed, at most 80 characters. Blank / not a string = null
 * (no project name).
 */
export function cleanProjectName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROJECT_NAME_MAX)
    .trim();
  return s || null;
}

/** Text search helper: does the project name contain the term (case-insensitive)? */
export function projectNameMatches(name: string | null | undefined, term: string): boolean {
  const t = term.trim().toLowerCase();
  return !!t && !!name && name.toLowerCase().includes(t);
}

/**
 * Step 50b: an email subject with the project name on the end:
 * "Ashtonne: quote Q-A-123 – Spring endcap". No project name = unchanged.
 */
export function withProject(subject: string, name: string | null | undefined): string {
  const p = cleanProjectName(name ?? null);
  return p ? `${subject} – ${p}` : subject;
}
