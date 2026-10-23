// scripts/test-foam-terms.ts
//
// Step 39N: the words shown for a foam job (app/lib/foam-terms.ts) and the
// CAD file names that use them. Set > parts > layers (cut from stock sheets).
// Run: npm run test:terms   (= npx --yes tsx scripts/test-foam-terms.ts)

import { count, partCustomName, partLabelShown, partName, partTitle } from "../app/lib/foam-terms";
import { buildLayerFilename } from "../app/lib/cad-download";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

check("title: Part 2", partTitle(1), "Part 2");
check("name: a saved default 'Layer 2' shows as Part 2", partName("Layer 2", 1), "Part 2");
check("name: 'Part 3' isn't repeated", partName("Part 3", 2), "Part 3");
check("name: own name kept", partName("Top Pad", 1), "Part 2 Top Pad");
check("name: blank -> Part 1", partName("  ", 0), "Part 1");
check("custom: default names are null", [partCustomName("Layer 1"), partCustomName("layer 12"), partCustomName("Part #2"), partCustomName(null)].every((x) => x === null), true);
check("custom: a real name", partCustomName(" Bottom Insert "), "Bottom Insert");
check("shown: Layer 4 -> Part 4", partLabelShown("Layer 4"), "Part 4");
check("shown: other names kept", partLabelShown("Bottom pad"), "Bottom pad");
check("count: plural", `${count(1, "layer")} / ${count(4, "layer")}`, "1 layer / 4 layers");
check(
  "file: default name -> Part-2 only",
  buildLayerFilename({ quoteNo: "Q-A-1", layerIndex: 1, layerLabel: "Layer 2", thicknessIn: 1, ext: "dxf", revision: "A" }),
  "Q-A-1__A__Part-2__1in.dxf",
);
check(
  "file: own name kept",
  buildLayerFilename({ quoteNo: "Q-A-1", layerIndex: 1, layerLabel: "Top Pad", thicknessIn: 1, ext: "step", revision: null }),
  "Q-A-1__Part-2__Top-Pad__1in.step",
);

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
