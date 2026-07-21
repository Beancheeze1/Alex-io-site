// app/lib/cad-download.ts
//
// Shared browser-side download helpers for CAD export files (DXF/STEP).
// Extracted from app/admin/quotes/[quote_no]/AdminQuoteClient.tsx, where
// these were previously defined locally and used only there. Now also used
// by app/quote/QuotePrintClient.tsx (the staff-facing quote view) — kept
// as one shared implementation rather than a second copy, given how many
// real bugs this project has traced back to exactly that pattern.

export function sanitizeFilenamePart(input: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  // Replace illegal-ish characters with dashes and collapse repeats
  const cleaned = s
    .replace(/[\s]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  // Keep it readable, not monstrous
  return cleaned.length > 48 ? cleaned.slice(0, 48) : cleaned;
}

export function buildFullPackageFilename(opts: {
  quoteNo: string;
  ext: "dxf" | "step" | "zip" | "svg";
  revision?: string | null;
}): string {
  const q = sanitizeFilenamePart(opts.quoteNo || "quote");
  const rev = sanitizeFilenamePart(opts.revision || "");
  const revPart = rev ? `__${rev}` : "";
  return `${q}__Full-Package${revPart}.${opts.ext}`;
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
