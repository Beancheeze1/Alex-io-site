// app/lib/ai/normalize.ts
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function inchesFrom(text: string, num: number, unit?: string | null) {
  const u = (unit || "").toLowerCase();
  if (u === "mm" || u === "millimeter" || u === "millimeters") return num / 25.4;
  return num; // in, inch, inches, default
}

export function cleanToken(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9.+/-]+/g, "").trim();
}
