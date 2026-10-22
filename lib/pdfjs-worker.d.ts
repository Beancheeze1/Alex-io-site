// lib/pdfjs-worker.d.ts
//
// Step 39F: pdfjs-dist ships no types for its worker file; lib/dieline-pdf.ts
// only loads it so pdfjs runs in process.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
