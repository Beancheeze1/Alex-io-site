// lib/artwork.ts
//
// Shared rules for print artwork uploads (Corrugated Step 6). Used by the
// /api/quote/artwork route (server) and by Start Quote, the rep form and the
// quote page (browser). No server-only imports, so it is safe in both.

export const ARTWORK_EXTENSIONS = ["pdf", "ai", "eps", "svg", "png", "jpg", "jpeg", "tif", "tiff"] as const;

/** For <input type="file" accept=...>. */
export const ARTWORK_ACCEPT = ARTWORK_EXTENSIONS.map((e) => "." + e).join(",");

export const ARTWORK_MAX_BYTES = 8 * 1024 * 1024;
export const ARTWORK_MAX_FILES = 10;

/** Stored content type is chosen from the extension, never from the client. */
export const ARTWORK_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  ai: "application/postscript",
  eps: "application/postscript",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export function artworkExt(name: string): string {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
}

/** A short, buyer-readable reason the file can't be used, or null if it's fine. */
export function artworkProblem(name: string, size: number): string | null {
  if (!(ARTWORK_EXTENSIONS as readonly string[]).includes(artworkExt(name))) {
    return `${name}: use PDF, AI, EPS, SVG, PNG, JPG or TIFF.`;
  }
  if (!(size > 0)) return `${name}: the file is empty.`;
  if (size > ARTWORK_MAX_BYTES) return `${name}: files must be 8 MB or smaller.`;
  return null;
}

/**
 * Browser helper: upload files one at a time to /api/quote/artwork (one file
 * per request keeps every body well under the 10 MB middleware cap).
 * Never throws; returns how many uploaded and a reason for each failure.
 */
export async function uploadArtwork(
  quoteNo: string,
  files: File[],
): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  for (const f of files) {
    const problem = artworkProblem(f.name, f.size);
    if (problem) {
      failed.push(problem);
      continue;
    }
    try {
      const fd = new FormData();
      fd.append("quote_no", quoteNo);
      fd.append("file", f, f.name);
      const res = await fetch("/api/quote/artwork", { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) ok += 1;
      else failed.push(`${f.name}: ${j?.message || "upload failed."}`);
    } catch {
      failed.push(`${f.name}: upload failed.`);
    }
  }
  return { ok, failed };
}
