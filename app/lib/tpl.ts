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
  out = out.replace(/ {2,}/g, " ").replace(/ ,/g, ",").trim();
  return out;
}

/** Tiny HTML→Text converter suitable for emails. */
export function htmlToText(html?: string): string {
  if (!html) return "";
  let s = html;

  // block-level line breaks
  s = s.replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "$&\n");

  // strip tags
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "")
       .replace(/<script[\s\S]*?<\/script>/gi, "")
       .replace(/<\/?[^>]+>/g, "");

  // decode a few common entities
  s = s.replace(/&nbsp;/gi, " ")
       .replace(/&amp;/gi, "&")
       .replace(/&lt;/gi, "<")
       .replace(/&gt;/gi, ">")
       .replace(/&quot;/gi, '"')
       .replace(/&#39;/gi, "'");

  // collapse whitespace / normalize newlines
  s = s.replace(/\r/g, "")
       .replace(/[ \t]+\n/g, "\n")
       .replace(/\n{3,}/g, "\n\n")
       .trim();

  return s;
}

/** Basic name helpers */
export function splitName(full?: string | null) {
  if (!full) return { firstName: "", lastName: "" };
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
