// scripts/test-foam-drawing.ts
//
// Step 40: a foam drawing (DXF or vector PDF) picked on the Start Quote form:
// the PDF is read like a DXF (lib/dxf/pdf-upload.ts -> facesFromSegments),
// the page border is skipped, the form's card summary (facesSummary), and
// the editor seed takes the form's thicknesses and layers (withFormLayers).
// Run: npm run test:foam-drawing

import { pdfFacesForUpload } from "../lib/dxf/pdf-upload";
import { dxfFacesForUpload, facesSummary } from "../lib/dxf/upload";
import { facesFromSegments } from "../lib/dxf/parse";
import { facesJsonToLayoutSeed, withFormLayers } from "../lib/forgeFacesSeed";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;
type C = { lengthIn: number; widthIn: number; depthIn: number; x: number; shape?: string };

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


const pt = (inches: number) => (inches * 72).toFixed(2);
const rect = (x: number, y: number, w: number, h: number) => `${pt(x)} ${pt(y)} ${pt(w)} ${pt(h)} re S`;
/** A circle from 4 Bezier curves (center cx, cy, radius r, inches). */
function circle(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  const P = (x: number, y: number) => `${pt(x)} ${pt(y)}`;
  return [
    `${P(cx + r, cy)} m`,
    `${P(cx + r, cy + k)} ${P(cx + k, cy + r)} ${P(cx, cy + r)} c`,
    `${P(cx - k, cy + r)} ${P(cx - r, cy + k)} ${P(cx - r, cy)} c`,
    `${P(cx - r, cy - k)} ${P(cx - k, cy - r)} ${P(cx, cy - r)} c`,
    `${P(cx + k, cy - r)} ${P(cx + r, cy - k)} ${P(cx + r, cy)} c`,
    "S",
  ].join("\n");
}

(async () => {
  // A 17 x 11 in sheet: border, a 12 x 8 in insert with a 4 x 3 pocket (left) and
  // a 2 in round pocket (right), a small title block box, and a dimension line.
  const content = [
    "0 0 0 RG 1 w",
    rect(0.25, 0.25, 16.5, 10.5), // page border
    rect(2, 1.5, 12, 8), // the insert
    rect(3, 4, 4, 3), // pocket 1 (left)
    circle(11, 5.5, 1), // pocket 2 (right), 2 in round
    rect(14.5, 0.5, 2, 0.75), // title block box
    `${pt(2)} ${pt(10)} m ${pt(14)} ${pt(10)} l S`, // dimension line (open)
  ].join("\n");
  const pdf = rawPdf(content, { w: 17 * 72, h: 11 * 72 });
  const r = await pdfFacesForUpload(pdf);
  check("40: the PDF drawing is read", r.ok, r);
  if (r.ok) {
    const f = r.faces;
    check("40: the part (biggest) comes first: 12 x 8 in", near(f.insert.lengthIn, 12) && near(f.insert.widthIn, 8), f.insert);
    check("40: source is pdf", f.source === "pdf");
    check("40: page border skipped (said in the warnings)", f.warnings.some((w) => /page border/.test(w)), f.warnings);
    check("40: the open dimension line is skipped (said)", f.warnings.some((w) => /didn't close/.test(w)), f.warnings);
    check("40: the title block box is a separate part, offered after", (f.inserts?.length ?? 1) === 2 && near(f.inserts![1].insert.lengthIn, 2), f.inserts?.map((x) => x.insert));
    const sum = facesSummary(f);
    check("40: summary: 12 x 8, 2 pockets, 2 parts", near(sum.length_in, 12) && near(sum.width_in, 8) && sum.cavities === 2 && sum.inserts === 2, sum);
    check("40: summary drawing is our own markup (no text)", sum.svg.startsWith("<svg") && !/<text|script/i.test(sum.svg));
    const seed = facesJsonToLayoutSeed(f);
    const cavs = (seed.stack?.[0]?.cavities ?? []) as unknown as C[];
    check("40: seed has the 12 x 8 block and 2 pockets", near(seed.block.lengthIn, 12, 0.05) && near(seed.block.widthIn, 8, 0.05) && cavs.length === 2, [seed.block, cavs.length]);
    const left = cavs.find((c: C) => near(c.lengthIn, 4, 0.05) && near(c.widthIn, 3, 0.05));
    check("40: not mirrored: the 4 x 3 pocket stays on the left", !!left && left.x < 0.3, left);
    const round = cavs.find((c: C) => c.shape === "circle" || (near(c.lengthIn, 2, 0.08) && near(c.widthIn, 2, 0.08)));
    check("40: the round pocket is about 2 in across", !!round, cavs.map((c: C) => [c.shape, c.lengthIn, c.widthIn]));

    // The form's layers: a 1.5 in bottom insert + 0.5 in top pad (Complete Pack)
    const withLayers = withFormLayers(seed, { thicknesses: [1.5, 0.5], labels: ["Bottom Insert", "Top Pad"], cropCorners: [false, true] });
    const st = withLayers.stack ?? [];
    check("40: form layers: 2 layers, 1.5 + 0.5", st.length === 2 && st[0].thicknessIn === 1.5 && st[1].thicknessIn === 0.5, st.map((l) => l.thicknessIn));
    check("40: form layers: names", st[0].label === "Bottom Insert" && st[1].label === "Top Pad");
    check("40: form layers: block = 2.0 total", withLayers.block.thicknessIn === 2);
    check("40: form layers: pockets on layer 1, top pad empty", st[0].cavities.length === 2 && st[1].cavities.length === 0);
    check("40: form layers: crop corners from the form", st[1].cropCorners === true);
    check("40: the editor opens on layer 1 (the pockets)", (withLayers as { layerCavityLayerIndex?: number }).layerCavityLayerIndex === 1);
    const thin = withFormLayers(seed, { thicknesses: [0.75] });
    check("40: pockets no deeper than the layer", ((thin.stack?.[0].cavities ?? []) as unknown as C[]).every((c: C) => c.depthIn <= 0.75), (thin.stack?.[0].cavities as unknown as C[] | undefined)?.map((c) => c.depthIn));
    check("40: no form layers = seed unchanged", withFormLayers(seed, null) === seed && withFormLayers(seed, { thicknesses: [] }) === seed);
  }

  // A scan / picture (no stroked lines)
  const scan = await pdfFacesForUpload(rawPdf("0 0 0 rg 72 72 200 100 re f", { w: 612, h: 792 }));
  check("40: a PDF with no drawn lines is refused with a clear message", !scan.ok && /no drawn lines/.test(scan.message), scan);

  // Segments: a loop around the page is skipped only with a page given (DXF unchanged)
  const sq = (x: number, y: number, w: number, h: number) => [
    { x1: x, y1: y, x2: x + w, y2: y },
    { x1: x + w, y1: y, x2: x + w, y2: y + h },
    { x1: x + w, y1: y + h, x2: x, y2: y + h },
    { x1: x, y1: y + h, x2: x, y2: y },
  ];
  const segs = [...sq(0, 0, 10, 10), ...sq(2, 2, 4, 4)];
  const asDxf = facesFromSegments(segs);
  const asPdf = facesFromSegments(segs, { source: "pdf", page: { w: 10.5, h: 10.5 } });
  check("40: without a page the outer loop is the part (DXF behavior)", near(asDxf.inserts[0].insert.lengthIn, 10));
  check("40: with the page, a loop around the page is skipped", near(asPdf.inserts[0].insert.lengthIn, 4));

  // A DXF still reads as before
  const dxf = ["0", "SECTION", "2", "ENTITIES",
    ...[[0, 0, 6, 0], [6, 0, 6, 4], [6, 4, 0, 4], [0, 4, 0, 0]].flatMap(([a, b, c, d]) => ["0", "LINE", "8", "0", "10", String(a), "20", String(b), "11", String(c), "21", String(d)]),
    "0", "ENDSEC", "0", "EOF"].join("\n");
  const d = dxfFacesForUpload(Buffer.from(dxf, "latin1"));
  check("40: DXF upload unchanged (6 x 4, source dxf)", d.ok && near(d.faces.insert.lengthIn, 6) && d.faces.source === "dxf", d);

  console.log(failed ? `${failed} FAILED` : "ALL PASS");
  process.exit(failed ? 1 : 0);
})();
