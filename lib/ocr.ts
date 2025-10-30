// lib/ocr.ts
import { createWorker } from "tesseract.js";

/**
 * OCR an image/PDF page buffer using tesseract.js.
 * This version uses the official tessdata CDN (online) for ENG.
 * Later, you can switch to an offline file in /public/tessdata (notes below).
 */
export async function ocrImageToText(buf: Buffer): Promise<string> {
  // Using CDN-hosted traineddata (v5). Works on Render by default.
  const worker = await createWorker("eng", 1, {
    // You can omit langPath to use the default CDN.
    // To force a path, uncomment the next line:
    // langPath: "https://tessdata.projectnaptha.com/5", // remote CDN
    logger: () => {}, // silence logs
  });

  try {
    const { data } = await worker.recognize(buf);
    return (data?.text || "").trim();
  } finally {
    await worker.terminate();
  }
}
