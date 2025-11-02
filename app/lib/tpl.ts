// app/lib/tpl.ts
export type Vars = Record<string, string | number | null | undefined>;

/** Very small templater: replaces {{key}} with string value; trims double spaces after removal. */
export function renderTemplate(s: string | undefined, vars: Vars): string | undefined {
  if (!s) return s;
  let out = s;
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return (v === null || v === undefined) ? "" : String(v);
  });
  // collapse leftover double spaces created by empty replacements
  out = out.replace(/ {2,}/g, " ").replace(/ ,/g, ",").trim();
  return out;
}

/** Basic name helpers */
export function splitName(full?: string | null) {
  if (!full) return { firstName: "", lastName: "" };
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
