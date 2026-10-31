// lib/merge-edits.ts
//
// Step 44h: save only what a form changed. A settings form (Admin -> Tenants)
// left open while the same record was saved somewhere else used to send its
// stale copy of every field and wipe those changes. mergeChanged keeps the
// latest saved values and puts on top only the fields the form changed since
// it was loaded. Pure (tested in scripts/test-merge-edits.ts).

export function mergeChanged<T extends Record<string, unknown>>(
  form: T,
  loaded: T,
  latest: T,
  keys: readonly (keyof T)[],
): T {
  const out: T = { ...latest };
  for (const k of keys) {
    if (JSON.stringify(form[k]) !== JSON.stringify(loaded[k])) out[k] = form[k];
  }
  return out;
}

/** The fields a form changed since it was loaded. */
export function changedKeys<T extends Record<string, unknown>>(form: T, loaded: T, keys: readonly (keyof T)[]): (keyof T)[] {
  return keys.filter((k) => JSON.stringify(form[k]) !== JSON.stringify(loaded[k]));
}
