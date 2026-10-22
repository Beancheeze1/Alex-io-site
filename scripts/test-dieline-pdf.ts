// scripts/test-dieline-pdf.ts
//
// Step 39F: vector PDF die lines (lib/dieline-pdf.ts) read the same way as a
// DXF (lib/dieline-import.ts), plus the drawing scale.
// Run: npm run test:dieline-pdf   (= npx --yes tsx scripts/test-dieline-pdf.ts)

import { PDFDocument, rgb } from "pdf-lib";
import { pdfColorIndex, pdfDielineLines } from "../lib/dieline-pdf";
import { analyzeDieline, buyerDielineParts, cleanDielineScale, parseDielineBlank, splitDieline } from "../lib/dieline-import";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

/** A tiny hand-written PDF (one page, the given content stream), optionally with layers (OCGs). */
function rawPdf(content: string, opts: { w?: number; h?: number; layers?: string[] } = {}): Uint8Array {
  const w = opts.w ?? 864;
  const h = opts.h ?? 576;
  const layers = opts.layers ?? [];
  const ocgIds = layers.map((_, i) => 5 + i);
  const objs: string[] = [];
  objs[1] =
    `<< /Type /Catalog /Pages 2 0 R` +
    (layers.length
      ? ` /OCProperties << /OCGs [${ocgIds.map((i) => `${i} 0 R`).join(" ")}] /D << /Order [${ocgIds.map((i) => `${i} 0 R`).join(" ")}] /ON [${ocgIds.map((i) => `${i} 0 R`).join(" ")}] >> >>`
      : "") +
    ` >>`;
  objs[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`;
  objs[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << ` +
    (layers.length ? `/Properties << ${layers.map((_, i) => `/oc${i + 1} ${ocgIds[i]} 0 R`).join(" ")} >> ` : "") +
    `>> >>`;
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  layers.forEach((name, i) => {
    objs[ocgIds[i]] = `<< /Type /OCG /Name (${name}) >>`;
  });
  let out = "%PDF-1.5\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

(async () => {
  // 1. colors -> DXF color numbers
  check("color: red = 1", pdfColorIndex("#ff0000") === 1 && pdfColorIndex("#e01010") === 1);
  check("color: black / gray / white = 7", pdfColorIndex("#000000") === 7 && pdfColorIndex("#808080") === 7 && pdfColorIndex("#ffffff") === 7);
  check("color: green 3, blue 5, magenta 6", pdfColorIndex("#00ff00") === 3 && pdfColorIndex("#0000ff") === 5 && pdfColorIndex("#ff00ff") === 6);

  // 2. a pdf-lib drawing: 2 parts, red crease, dashed crease, a circle, a filled logo and text (skipped)
  const doc = await PDFDocument.create();
  const page = doc.addPage([20 * 72, 12 * 72]);
  const L = (x1: number, y1: number, x2: number, y2: number, o: { color?: ReturnType<typeof rgb>; dash?: number[] } = {}) =>
    page.drawLine({ start: { x: x1 * 72, y: y1 * 72 }, end: { x: x2 * 72, y: y2 * 72 }, thickness: 0.5, color: o.color ?? rgb(0, 0, 0), dashArray: o.dash });
  L(1, 1, 11, 1); L(11, 1, 11, 9); L(11, 9, 1, 9); L(1, 9, 1, 1);
  L(1, 3, 11, 3, { color: rgb(1, 0, 0) });
  L(6, 1, 6, 9, { dash: [6, 3] });
  L(13, 1, 18, 1); L(18, 1, 18, 5); L(18, 5, 13, 5); L(13, 5, 13, 1);
  page.drawCircle({ x: 15.5 * 72, y: 3 * 72, size: 0.5 * 72, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
  page.drawRectangle({ x: 14 * 72, y: 8 * 72, width: 72, height: 36, color: rgb(0, 0, 1) });
  page.drawText("QA PDF DIELINE", { x: 72, y: 10.5 * 72, size: 14 });
  const two = await pdfDielineLines(await doc.save());
  check("pdf-lib drawing: read", two.ok, two);
  if (two.ok) {
    const a = analyzeDieline(two.lines);
    check("analyze: ok, 2 pieces", a.ok && a.measure.pieces === 2, a.ok ? a.measure : a);
    if (a.ok) {
      const g = (k: string) => a.groups.find((x) => x.key === k);
      check("solid black = cut (36 + 18 + circle 3.1)", near(g("0|CONTINUOUS|7")?.length_in ?? 0, 57.1, 0.1) && g("0|CONTINUOUS|7")?.role === "cut", a.groups);
      check("red = crease (10)", g("0|CONTINUOUS|1")?.role === "crease" && near(g("0|CONTINUOUS|1")?.length_in ?? 0, 10), a.groups);
      check("dashed = crease (8)", g("0|DASHED|7")?.role === "crease" && near(g("0|DASHED|7")?.length_in ?? 0, 8), a.groups);
      check("filled logo and text skipped (3 groups only)", a.groups.length === 3, a.groups.map((x) => x.key));
      check("units: PDF at full size", a.units === "in" && /PDF at full size/.test(a.units_label), a.units_label);
      check("20 x 12 page: no paper-page warning", !a.warnings.some((w) => /standard paper page/.test(w)), a.warnings);
    }
    const sp = splitDieline(two.lines);
    check(
      "split: 10 x 8 and 5 x 4",
      sp.ok && sp.pieces.length === 2 && near(sp.pieces[0].length_in, 10) && near(sp.pieces[0].width_in, 8) && near(sp.pieces[1].length_in, 5) && near(sp.pieces[1].width_in, 4),
      sp,
    );
    const buyer = buyerDielineParts(two.lines, "display.pdf", [{ piece: 2, label: "Shelf", per_display: 3 }]);
    check("buyer parts from a PDF: display, Shelf x3, check", buyer.ok && buyer.display && buyer.parts[1].label === "Shelf" && buyer.parts[1].per_display === 3 && buyer.parts.every((p) => p.check), buyer);
  }

  // 3. layers (OCGs) win: blue lines on a "Crease" layer are creases; cm transform is applied
  const layered = rawPdf(
    "q 0 0 1 RG /OC /oc1 BDC 72 72 m 720 72 l 720 432 l 72 432 l h S EMC " +
      "/OC /oc2 BDC 72 216 m 720 216 l S EMC Q " +
      "q 2 0 0 2 0 0 cm 0 0 0 RG 400 40 m 418 40 l S Q",
    { layers: ["Cut", "Crease"] },
  );
  const lay = await pdfDielineLines(layered);
  check("layered PDF: read, layers listed", lay.ok && lay.lines.pdf.layers.includes("Cut") && lay.lines.pdf.layers.includes("Crease"), lay.ok ? lay.lines.pdf : lay);
  if (lay.ok) {
    const a = analyzeDieline(lay.lines);
    const g = (layer: string) => (a.ok ? a.groups.find((x) => x.layer === layer) : undefined);
    check("layer Cut = cut, 9 x 5 outline = 28 in", g("Cut")?.role === "cut" && near(g("Cut")?.length_in ?? 0, 28), a.ok ? a.groups : a);
    check("layer Crease = crease (blue, but the layer name wins), 9 in", g("Crease")?.role === "crease" && near(g("Crease")?.length_in ?? 0, 9), a.ok ? a.groups : a);
    check("cm transform x2: 18 pt line drawn at 2x = 0.5 in", near(g("0")?.length_in ?? 0, 0.5), a.ok ? a.groups : a);
  }

  // 4. a scan / picture (only filled shapes) is refused; not a PDF is refused
  const scan = await pdfDielineLines(rawPdf("q 0 0 0 rg 72 72 300 200 re f Q"));
  check("no stroked lines -> not_vector", !scan.ok && scan.error === "not_vector", scan);
  const notPdf = await pdfDielineLines(new Uint8Array(Buffer.from("0\nSECTION\n")));
  check("a DXF is not a PDF -> not_pdf", !notPdf.ok && notPdf.error === "not_pdf", notPdf);

  // 5. drawing on a letter page: warned; drawing scale 1:2 doubles every size
  const letter = await pdfDielineLines(rawPdf("q 0 0 0 RG 72 72 m 360 72 l 360 288 l 72 288 l h S Q", { w: 612, h: 792 }));
  if (letter.ok) {
    const a1 = analyzeDieline(letter.lines);
    check("letter page: 4 x 3 blank, paper-page warning", a1.ok && near(a1.measure.length_in, 4) && near(a1.measure.width_in, 3) && a1.warnings.some((w) => /standard paper page/.test(w)), a1);
    const a2 = analyzeDieline(letter.lines, { scale: 2 });
    check("scale 1:2: 8 x 6, rule 28, label says 1:2, no paper warning", a2.ok && near(a2.measure.length_in, 8) && near(a2.measure.width_in, 6) && near(a2.measure.rule_in, 28) && /1:2/.test(a2.units_label) && !a2.warnings.some((w) => /standard paper page/.test(w)), a2);
  } else check("letter page read", false, letter);
  check("cleanDielineScale: junk -> 1, keeps 4", cleanDielineScale("x") === 1 && cleanDielineScale(-2) === 1 && cleanDielineScale("4") === 4);
  check("stored blank keeps scale", parseDielineBlank({ length_in: 8, width_in: 6, cut_in: 28, crease_in: 0, perf_in: 0, rule_in: 28, scale: 2 })?.scale === 2);

  console.log(failed ? `${failed} FAILED` : "ALL PASS");
  process.exit(failed ? 1 : 0);
})();
