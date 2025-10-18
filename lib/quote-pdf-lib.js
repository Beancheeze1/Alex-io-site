// lib/quote-pdf-lib.js
/**
 * Path-A shim: satisfy imports without pulling pdf-lib right now.
 * Replace later with a real implementation that uses `pdf-lib`.
 */

export async function renderQuotePdf(/* args */) {
  // return an empty PDF-like byte array; callers can check .byteLength safely
  return new Uint8Array();
}

// also provide a default export for safety
export default { renderQuotePdf };
