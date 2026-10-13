// lib/quote-types.ts
//
// Step 11: which quote types a shop offers. Stored per shop as
// tenants.theme_json.quoteTypes (set by the platform owner on the Tenants
// page). Missing or empty = every type (the default for existing shops).
// One list for everyone: buyers, reps and admins all see only these types.
// Client-safe (no DB); the server-side lookup is lib/quote-types-server.ts.

export type QuoteTypeKey = "foam_insert" | "complete_pack" | "boxes_only";

export const QUOTE_TYPE_KEYS: QuoteTypeKey[] = ["foam_insert", "complete_pack", "boxes_only"];

export const QUOTE_TYPE_LABELS: Record<QuoteTypeKey, string> = {
  foam_insert: "Foam insert",
  complete_pack: "Complete Pack (box + foam)",
  boxes_only: "Boxes only",
};

/** The shop's offered types, in canonical order. Missing / empty / invalid = all types. */
export function quoteTypesFromTheme(theme: unknown): QuoteTypeKey[] {
  const raw =
    theme && typeof theme === "object" && !Array.isArray(theme)
      ? (theme as Record<string, unknown>).quoteTypes
      : null;
  if (!Array.isArray(raw)) return [...QUOTE_TYPE_KEYS];
  const picked = QUOTE_TYPE_KEYS.filter((k) => raw.includes(k));
  return picked.length > 0 ? picked : [...QUOTE_TYPE_KEYS];
}

/** True when the shop offers any foam quote (Foam insert or Complete Pack). */
export function offersFoam(types: QuoteTypeKey[]): boolean {
  return types.includes("foam_insert") || types.includes("complete_pack");
}
