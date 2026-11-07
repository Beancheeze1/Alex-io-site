// scripts/test-project-name.ts
//
// Step 50: the project name on a quote (lib/project-name.ts).
// Run: npm run test:project-name

import { cleanProjectName, projectNameMatches, PROJECT_NAME_MAX } from "../lib/project-name";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

check("trimmed", cleanProjectName("  Kroger endcap  ") === "Kroger endcap");
check("spaces collapsed", cleanProjectName("Spring   promo\tshippers") === "Spring promo shippers");
check("line breaks become spaces", cleanProjectName("Line one\nline two") === "Line one line two");
check("blank = null", cleanProjectName("   ") === null && cleanProjectName("") === null);
check("not a string = null", cleanProjectName(42) === null && cleanProjectName(null) === null && cleanProjectName(undefined) === null);
check("capped at 80", cleanProjectName("x".repeat(200))?.length === PROJECT_NAME_MAX && PROJECT_NAME_MAX === 80);
check("no trailing space after the cap", !/\s$/.test(cleanProjectName("a".repeat(79) + " bbbb") ?? ""));
check("keeps punctuation", cleanProjectName("Q4 '26 – Endcap #3 (Walmart)") === "Q4 '26 – Endcap #3 (Walmart)");
check("match is case-insensitive", projectNameMatches("Kroger Endcap", "endcap") && projectNameMatches("Kroger Endcap", "KROG"));
check("no match / empty term / no name", !projectNameMatches("Kroger", "walmart") && !projectNameMatches("Kroger", " ") && !projectNameMatches(null, "k"));

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
