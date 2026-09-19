// scripts/verify-technical-drawing-block-dims.mjs
//
// Regression test for a bug reported against the technical-drawing PDF
// generator (lib/pdf/threeview.ts), first observed on quote
// Q-REP-20260914-221352: the "Block Dims" callout in the LAYER DETAILS
// panel showed the wrong Z value (a cavity's pocket depth, or in
// multi-layer stacks the top-level block's stale/shared height) instead of
// the layer actually drawn on that sheet.
//
// generate3ViewPDF() draws ONE PAGE PER LAYER. `block` (L/W footprint) is
// loop-invariant and correctly shared across every page, but each page's
// own `layer.thicknessIn` must drive the Z/height component of both the
// drawn geometry AND the "Block Dims" text -- the drawn geometry and the
// "Thickness" row already read layer.thicknessIn correctly; "Block Dims"
// was the one place still reading input.block.heightIn, which is a single
// top-level value that does not vary per layer and does not track pocket
// depth at all.
//
// This is a pure function (no DB, no server, no auth) -- generate3ViewPDF
// takes a plain Drawing3DInput object and returns a PDF Buffer -- so this
// script drives it directly and parses the resulting PDF text with
// pdf-parse to assert on what each sheet actually prints.
//
// Covers:
//   1) The exact reported scenario: 2-layer stack, Layer 1 thickness=5.000
//      with a cavity pocket depth of 1.000 -- Sheet 1 Block Dims Z must be
//      5.000, not 1.000. Sheet 2 (Layer 2, thickness=1.000, no cavity)
//      checked independently, to rule out cross-contamination between
//      sheets.
//   2) A different case where thickness, pocket depth, and the stale
//      top-level block height are three distinct numbers on the SAME
//      layer, to conclusively prove which field is read.
//   3) A single-layer, no-cavity quote -- must still render correctly
//      (regression check for the common case this bug could have broken).
//
// Usage:
//   npx tsx scripts/verify-technical-drawing-block-dims.mjs

import { generate3ViewPDF } from "../lib/pdf/threeview.ts";

// pdf-parse (via pdfjs-dist's legacy build) expects a handful of browser DOM
// APIs to exist even for plain text extraction with no rendering. Minimal
// stand-ins so it doesn't throw at module load / text-extraction time in
// plain Node -- this script only reads text, never rasterizes, so these
// never need real geometry behind them.
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; }
    translate() { return this; }
    scale() { return this; }
    multiply() { return this; }
  };
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth; this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth; this.width = widthOrHeight; this.height = height;
      }
    }
  };
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {};
}

let PDFParseCls;
async function getPDFParseClass() {
  if (!PDFParseCls) {
    const m = await import("pdf-parse");
    PDFParseCls = m.PDFParse;
  }
  return PDFParseCls;
}

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!cond) failures++;
}

// Extracts the "Block Dims: L x W x Z" value from one page's own text.
function extractBlockDimsZ(pageText) {
  const m = /Block Dims:\s*([\d.]+)"\s*\xD7\s*([\d.]+)"\s*\xD7\s*([\d.]+)"/.exec(pageText);
  return m ? { L: m[1], W: m[2], Z: m[3] } : null;
}

function extractThickness(pageText) {
  const m = /Thickness:\s*([\d.]+)"/.exec(pageText);
  return m ? m[1] : null;
}

// Returns per-page text arrays, in page order -- pdf-parse v2's PDFParse
// class extracts text per-page directly (no need to infer page boundaries
// from concatenated text).
async function pdfPages(buffer) {
  const PDFParse = await getPDFParseClass();
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.pages.map((p) => p.text);
}

console.log("=== Case 1: Chuck's exact reported scenario (Q-REP-20260914-221352 shape) ===");
console.log("2-layer stack -- Layer 1: thickness 5.000, cavity depth 1.000. Layer 2: thickness 1.000, no cavity.");
{
  const input = {
    quoteNo: "Q-VERIFY-BLOCKDIMS-1",
    customerName: "Verify Customer",
    block: { lengthIn: 13.875, widthIn: 11.875, heightIn: 1.0 }, // deliberately WRONG/stale top-level value, matching the reported bug shape (equals the cavity depth, not either layer's thickness)
    layers: [
      {
        id: "layer_1", label: "Layer 1", thicknessIn: 5.0, materialName: "PE Foam",
        cavities: [{ id: "cav1", shape: "rect", x: 0.3, y: 0.3, lengthIn: 4, widthIn: 4, depthIn: 1.0 }],
      },
      {
        id: "layer_2", label: "Layer 2", thicknessIn: 1.0, materialName: "PE Foam",
        cavities: [],
      },
    ],
    revision: "A",
    date: "2026-09-19",
  };

  const buf = await generate3ViewPDF(input);
  const pages = await pdfPages(buf);
  check("PDF has 2 pages (one per layer)", pages.length === 2, `got ${pages.length}`);
  const dims1 = extractBlockDimsZ(pages[0]);
  const dims2 = extractBlockDimsZ(pages[1]);
  const thick1 = extractThickness(pages[0]);
  const thick2 = extractThickness(pages[1]);

  check("Sheet 1 (Layer 1) Block Dims Z = 5.000 (matches Thickness, not the 1.000 cavity depth or the stale block.heightIn)",
    dims1?.Z === "5.000", `got Z="${dims1?.Z}" on page 1: ${JSON.stringify(pages[0]?.slice(0, 200))}`);
  check("Sheet 1 Thickness row also 5.000 (unchanged, was already correct)", thick1 === "5.000", `got "${thick1}"`);
  check("Sheet 2 (Layer 2) Block Dims Z = 1.000 (own thickness, independent of Sheet 1)",
    dims2?.Z === "1.000", `got Z="${dims2?.Z}"`);
  check("Sheet 2 Thickness row also 1.000", thick2 === "1.000", `got "${thick2}"`);
  check("Sheet 1 and Sheet 2 Z values are NOT identical (no cross-contamination)", dims1?.Z !== dims2?.Z, `${dims1?.Z} vs ${dims2?.Z}`);
  check("L/W footprint identical on both sheets (13.875 x 11.875, correctly shared)",
    dims1?.L === "13.875" && dims1?.W === "11.875" && dims2?.L === "13.875" && dims2?.W === "11.875",
    JSON.stringify({ dims1, dims2 }));
}

console.log("\n=== Case 2: different quote, thickness != pocket depth on the SAME layer, to conclusively prove which field is read ===");
{
  // Layer's own thickness (2.250) is deliberately different from its own
  // cavity depth (0.750) AND from the stale top-level block.heightIn
  // (3.500, matching neither) -- three distinct numbers so there is no way
  // for a coincidental match to hide a regression.
  const input = {
    quoteNo: "Q-VERIFY-BLOCKDIMS-2",
    customerName: "Verify Customer 2",
    block: { lengthIn: 9.5, widthIn: 7.25, heightIn: 3.5 },
    layers: [
      {
        id: "layer_1", label: "Layer 1", thicknessIn: 2.25, materialName: "PU Foam",
        cavities: [{ id: "cav1", shape: "circle", x: 0.4, y: 0.4, lengthIn: 2, widthIn: 2, depthIn: 0.75 }],
      },
    ],
    revision: "AS",
    date: "2026-09-19",
  };

  const buf = await generate3ViewPDF(input);
  const pages = await pdfPages(buf);
  const dims = extractBlockDimsZ(pages[0]);

  check("Block Dims Z = layer thickness (2.250), not the cavity depth (0.750) or the stale block.heightIn (3.500)",
    dims?.Z === "2.250", `got Z="${dims?.Z}"`);
}

console.log("\n=== Case 3: single-layer, no-cavity quote (regression check for the common case) ===");
{
  const input = {
    quoteNo: "Q-VERIFY-BLOCKDIMS-3",
    customerName: "Verify Customer 3",
    block: { lengthIn: 12, widthIn: 10, heightIn: 4 },
    layers: [
      { id: "layer_1", label: "Layer 1", thicknessIn: 4, materialName: "EPE Foam", cavities: [] },
    ],
    revision: "A",
    date: "2026-09-19",
  };

  const buf = await generate3ViewPDF(input);
  const pages = await pdfPages(buf);
  const dims = extractBlockDimsZ(pages[0]);

  check("Single-layer, no-cavity: Block Dims Z = 4.000 (layer thickness), unaffected by the fix", dims?.Z === "4.000", `got Z="${dims?.Z}"`);
  check("Cavity schedule correctly shows None for this sheet", /Cavities:\s*None/.test(pages[0]));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
