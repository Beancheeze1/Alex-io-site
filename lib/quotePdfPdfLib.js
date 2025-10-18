// lib/quotePdfPdfLib.js
/**
 * Some routes import this variant; provide the same shim.
 */

export async function renderQuotePdf(/* args */) {
  return new Uint8Array();
}

export default { renderQuotePdf };
