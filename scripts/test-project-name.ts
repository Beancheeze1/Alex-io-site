// scripts/test-project-name.ts
//
// Step 50: the project name on a quote (lib/project-name.ts).
// Run: npm run test:project-name

import { cleanProjectName, projectNameMatches, PROJECT_NAME_MAX, withProject } from "../lib/project-name";
import { statusEmail } from "../app/lib/quote-mail-core"; // Step 50b
import { renderQuoteEmail } from "../app/lib/email/quoteTemplate"; // Step 50b

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

// Step 50b: email subjects and bodies
check("subject gets the project", withProject("Shop: quote Q-1", "Spring endcap") === "Shop: quote Q-1 – Spring endcap");
check("no project = subject unchanged", withProject("Shop: quote Q-1", null) === "Shop: quote Q-1" && withProject("Shop: quote Q-1", "  ") === "Shop: quote Q-1");
const sd = { brand: "Test Shop", quoteNo: "Q-A-261107-00001", link: "https://x.example/quote", total: 100, buyerName: "Pat" };
const conf = statusEmail("confirmed", { ...sd, projectName: "Spring endcap" });
check("status subject gets the project", conf.subject === "Test Shop: order confirmed for quote Q-A-261107-00001 – Spring endcap", conf.subject);
check("status email has a Project row", conf.html.includes(">Project<") && conf.html.includes("Spring endcap"));
const confNone = statusEmail("confirmed", sd);
check("status email without a project unchanged", confNone.subject === "Test Shop: order confirmed for quote Q-A-261107-00001" && !confNone.html.includes(">Project<"));
check("project row escaped", statusEmail("shipped", { ...sd, projectName: "<b>x</b>" }).html.includes("&lt;b&gt;x&lt;/b&gt;"));
const qbase = {
  customerLine: "Pat",
  quoteNumber: "Q-A-261107-00001",
  status: "applied",
  specs: { L_in: 10, W_in: 8, H_in: 4, qty: 100 },
  material: { name: null, density_lbft3: null, kerf_pct: null, min_charge: null },
  pricing: { total: 100 },
  missing: [],
  brand: "Test Shop",
  plainLinks: true,
} as Parameters<typeof renderQuoteEmail>[0];
const qe = renderQuoteEmail({ ...qbase, projectName: "Spring & endcap" });
check("quote email names the project", qe.includes("data-quote-project") && qe.includes("Spring &amp; endcap"));
check("quote email without a project unchanged", !renderQuoteEmail(qbase).includes("data-quote-project"));

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
