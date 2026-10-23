// scripts/test-job-ticket.ts
//
// Step 39M: the job ticket's foam sheet build (app/lib/job-ticket-core.ts
// foamBuildForTicket / sheetLayout), the sheet DXFs it points to and the
// ticket PDF with a build. No database.
// Run: npm run test:ticket   (= npx --yes tsx scripts/test-job-ticket.ts)

import { foamGeometry, withSheets } from "../app/lib/pricing/foam-geometry";
import { foamBuildForTicket, sheetLayout, type JobTicket } from "../app/lib/job-ticket-core";
import { buildDxfForLayer } from "../app/lib/layout/layer-dxf";
import { jobTicketPdf } from "../lib/pdf/job-ticket";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Chuck's test quote: a 7" bottom with a 3" and a 1" deep cavity + a plain 1" top pad, stock 1" and 2".
const layout = {
  block: { lengthIn: 10, widthIn: 10, thicknessIn: 8 },
  stack: [
    {
      label: "Bottom Insert",
      thicknessIn: 7,
      cavities: [
        { shape: "rect", lengthIn: 3, widthIn: 2, depthIn: 3, x: 0.1, y: 0.1 },
        { shape: "rect", lengthIn: 2, widthIn: 2, depthIn: 1, x: 0.6, y: 0.6 },
      ],
    },
    { label: "Top Pad", thicknessIn: 1, cavities: [] },
  ],
};
const geom = withSheets(foamGeometry(layout, { L: 10, W: 10, H: 8 }), [1, 2]);
const build = foamBuildForTicket({ geom, labels: ["Bottom Insert", "Top Pad"], quoteNo: "Q-A-1", revision: "A" });
if (!build) throw new Error("no build");

check("build: 5 sheets per set", build.sheets_per_part, 5);
check("build: 3 glue lines", build.glue_lines, 3);
check("build: stock listed", build.stock_in.join(","), "2,1");
//   bottom sheets from the cavity face: 1 (0-1, both cavities), 2 (1-3, deep cavity), 3 and 4 (3-5, 5-7, solid); top pad 1 sheet
check(
  "build: sheets in order",
  build.sheets.map((s) => `${s.layer}.${s.n}:${s.from_in}+${s.thickness_in}@${s.stock_in}/${s.cavities}`).join(" "),
  "1.1:0+1@1/2 1.2:1+2@2/1 1.3:3+2@2/0 1.4:5+2@2/0 2.1:0+1@1/0",
);
check("build: 3 sheet files (= 3 dies)", build.files.length, 3);
check("build: file per-set counts", build.files.map((f) => f.per_part).join(","), "1,1,3");
check("build: solid file used by both layers", build.files[2].used_in, "Layer 1 sheets 3-4, Layer 2 sheet 1");
check("build: file names", build.files.map((f) => f.name).join(" | "), "Q-A-1__A__Sheet-1__2-cavities | Q-A-1__A__Sheet-2__1-cavity | Q-A-1__A__Sheet-3__solid");
check("build: sheet 2 file keeps only the deep cavity", build.files[1].cavity_index.join(","), "0");
check(
  "build: steps",
  build.steps.join(" / "),
  "Layer 1 Bottom Insert: laminate sheets 1-4 (3 glue lines), sheet 1 on the cavity face. / Layer 2 Top Pad: one sheet, no lamination. / Layer 2 Top Pad: separate piece, pack loose (not glued).",
);

// Glued layers get a glue step; a skived sheet is flagged
const glued = withSheets(
  foamGeometry(
    { block: { lengthIn: 10, widthIn: 10, thicknessIn: 2.5 }, stack: [{ thicknessIn: 1.5, cavities: [] }, { thicknessIn: 1, cavities: [], loose: false }] },
    { L: 10, W: 10, H: 2.5 },
  ),
  [2, 1],
);
const gb = foamBuildForTicket({ geom: glued, labels: [null, null], quoteNo: "Q-A-2", revision: null });
check("glued: glue step between layers", gb?.steps.includes("Glue layer 1 to layer 2 (1 glue line)."), true);
check("glued: 1.5\" layer skived from 2\" stock", gb?.sheets[0].skived === true && gb?.sheets[0].stock_in === 2, true);
check("glued: one solid file for both layers", gb?.files.length, 1);
const plainNames = foamBuildForTicket({ geom, labels: ["Layer 1", "Layer 2"], quoteNo: "Q-A-3", revision: null });
check("steps: default layer names aren't repeated", plainNames?.steps[0], "Layer 1: laminate sheets 1-4 (3 glue lines), sheet 1 on the cavity face.");
check("no sheets: no build", foamBuildForTicket({ geom: foamGeometry(layout, { L: 10, W: 10, H: 8 }), labels: [], quoteNo: "x", revision: null }), null);

// Sheet DXFs: outline + only the cavities cut through that sheet
const count = (dxf: string | null, kind: string) => (dxf || "").split("\n").filter((l, i, a) => l === kind && a[i - 1] === "0").length;
const full = buildDxfForLayer(layout, 0);
const sheet1 = buildDxfForLayer(sheetLayout(layout, build.files[0])!, 0);
const sheet2 = buildDxfForLayer(sheetLayout(layout, build.files[1])!, 0);
const solid = buildDxfForLayer(sheetLayout(layout, build.files[2])!, 0);
check("dxf: layer file = outline + 2 cavities (12 lines)", count(full, "LINE"), 12);
check("dxf: sheet 1 = same as the layer (both cavities)", count(sheet1, "LINE"), 12);
check("dxf: sheet 2 = outline + the deep cavity (8 lines)", count(sheet2, "LINE"), 8);
check("dxf: solid sheet = outline only (4 lines)", count(solid, "LINE"), 4);
check("dxf: sheetLayout leaves other layers alone", (sheetLayout(layout, build.files[2])!.stack as { cavities: unknown[] }[])[1].cavities.length, 0);
const noStack = sheetLayout({ block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 }, cavities: [{ lengthIn: 2, widthIn: 2, depthIn: 1, x: 0.2, y: 0.2 }] }, { layer_index: 0, cavity_index: [0] });
check("dxf: a layout with no stack gets one layer", Array.isArray(noStack?.stack) && (noStack!.stack as unknown[]).length === 1, true);

// The ticket PDF draws the build
(async () => {
  const ticket: JobTicket = {
    shop: "QA Shop",
    quote_no: "Q-A-1",
    revision: "A",
    created_at: null,
    released_at: null,
    released_by: null,
    customer: { name: "QA", company: null, email: null, phone: null },
    po: null,
    rush: false,
    accepted: null,
    confirmed: null,
    lead_time: null,
    ship: { terms: "prepaid_add", terms_label: "Prepaid & add", name: null, company: null, lines: [], account: null, mode: null, cartons: null, pallets: null, weight_lb: null },
    foam: {
      sets: 540,
      material: "EPE",
      block: { L: 10, W: 10, H: 8 },
      layers: [
        { n: 1, label: "Bottom Insert", thickness_in: 7, material: "EPE", cavities: 2, loose: false, cut_file: "Q-A-1__A__Layer-1" },
        { n: 2, label: "Top Pad", thickness_in: 1, material: "EPE", cavities: 0, loose: true, cut_file: "Q-A-1__A__Layer-2" },
      ],
      package_file: "Q-A-1__A__Full",
      release_pkg_id: null,
      build: { ...build, note: "Priced before sheet-by-sheet lamination." },
    },
    boxes: [],
    proof: null,
    customer_notes: null,
  };
  const bytes = await jobTicketPdf(ticket, {});
  check("pdf: builds with a sheet build", bytes.length > 1000, true);
  console.log(failed ? `${failed} FAILED` : "ALL PASS");
  process.exit(failed ? 1 : 0);
})();
