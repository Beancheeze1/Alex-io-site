// lib/corrugated/grade-match.ts
//
// Step 37G: a buyer's own words for board grade ("32 ECT", "44ect bc",
// "200#", "double wall") -> a short label for the chat summary, and the
// shop's matching grade for the quote form. Pure (client-safe; tested in
// scripts/test-grade.ts).

export type GradeText = {
  ect: number | null; // 32, 44, 48, 51...
  mullen: number | null; // 200, 275... (burst test, "#")
  flute: string | null; // "C", "B", "E", "BC", "EB", "F"
  label: string; // "32 ECT C", "200#", "double wall"
};

export type GradeChoice = { id: number; name: string; flute: string; ect_label: string; is_default: boolean };

/** Reads a board grade out of free text. null when nothing grade-like is said. */
export function parseGradeText(text: unknown): GradeText | null {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  const ectM = t.match(/\b(\d{2,3})\s*-?\s*(?:ect|e\.c\.t\.?)(?![a-z])/i);
  const mulM = t.match(/\b(1[2-9]\d|2\d\d|3[0-5]\d)\s*(?:#|lbs?\b|pound\b|test\b|mullen\b)/i);
  let flute: string | null = null;
  const fm =
    t.match(/\b(bc|eb|c|b|e|f)\s*-?\s*flute\b/i) ||
    t.match(/\bflute\s*:?\s*(bc|eb|c|b|e|f)\b/i) ||
    (ectM || mulM ? t.match(/\b(?:ect|#)\s*(bc|eb|c|b|e|f)\b/i) : null) ||
    (ectM ? t.match(new RegExp(`\\b${ectM[1]}\\s*-?\\s*ect\\s*-?\\s*(bc|eb|c|b|e|f)\\b`, "i")) : null);
  if (fm) flute = fm[1].toUpperCase();
  const doubleWall = /\bdouble[\s-]?wall\b|\bdw\b/i.test(t);
  if (!flute && doubleWall) flute = "BC";
  const ect = ectM ? Number(ectM[1]) : null;
  const mullen = !ect && mulM ? Number(mulM[1]) : null;
  if (ect == null && mullen == null && !flute) return null;
  const label =
    ect != null
      ? `${ect} ECT${flute ? ` ${flute}` : ""}`
      : mullen != null
        ? `${mullen}#${flute ? ` ${flute}` : ""}`
        : doubleWall
          ? "double wall"
          : `${flute} flute`;
  return { ect, mullen, flute, label };
}

function gradeEct(g: GradeChoice): number | null {
  const m = `${g.ect_label} ${g.name}`.match(/\b(\d{2,3})\s*ect\b/i);
  return m ? Number(m[1]) : null;
}

function gradeMullen(g: GradeChoice): number | null {
  const m = `${g.ect_label} ${g.name}`.match(/\b(\d{3})\s*(?:#|lb)/i);
  return m ? Number(m[1]) : null;
}

/**
 * The shop grade that matches what the buyer said, or null (then the shop
 * recommends one and the words go into the notes). With no flute given, the
 * shop's default grade wins, then C flute, then the first match.
 */
export function matchGrade(text: unknown, grades: GradeChoice[]): number | null {
  const g = parseGradeText(text);
  if (!g || !Array.isArray(grades) || !grades.length) return null;
  let pool = grades.filter((x) =>
    g.ect != null ? gradeEct(x) === g.ect : g.mullen != null ? gradeMullen(x) === g.mullen : true,
  );
  if (g.flute) pool = pool.filter((x) => String(x.flute || "").toUpperCase() === g.flute);
  if (!pool.length) return null;
  if (g.ect == null && g.mullen == null && pool.length > 1) {
    // flute only ("double wall"): take the shop's default if it has that flute, else the lightest
    const def = pool.find((x) => x.is_default);
    if (def) return def.id;
    return [...pool].sort((a, b) => (gradeEct(a) ?? 999) - (gradeEct(b) ?? 999))[0].id;
  }
  return (
    pool.find((x) => x.is_default)?.id ??
    pool.find((x) => String(x.flute).toUpperCase() === "C")?.id ??
    pool[0].id
  );
}
