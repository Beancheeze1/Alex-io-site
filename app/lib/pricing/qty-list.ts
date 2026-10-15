// app/lib/pricing/qty-list.ts
//
// Step 24: compare-quantity lists for foam "Price by quantity". Pure (no DB),
// so the foam tests can check them.

const MAX_QTY = 10_000_000;

/** Whole numbers 1..10M, unique, ascending (array, JSON string or "a,b,c"). */
export function cleanQtyList(raw: unknown): number[] {
  let list: unknown = raw;
  if (typeof list === "string") {
    const t = list.trim();
    if (t.startsWith("[")) {
      try {
        list = JSON.parse(t);
      } catch {
        list = [];
      }
    } else {
      list = t.split(/[,\s]+/);
    }
  }
  if (!Array.isArray(list)) return [];
  const set = new Set<number>();
  for (const v of list) {
    const x = typeof v === "object" && v !== null ? (v as { qty?: unknown }).qty : v;
    const n = Number(x);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_QTY) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** The ordered qty plus up to 3 others (smallest first), ascending. */
export function foamBreakList(current: number, extras: number[]): number[] {
  const others = extras.filter((n) => n !== current).slice(0, 3);
  return [...new Set([current, ...others])].sort((a, b) => a - b);
}
