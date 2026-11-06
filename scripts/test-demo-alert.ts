// scripts/test-demo-alert.ts
//
// Step 48: the sales email for a landing-page demo quote (lib/demo-alert.ts).
// Run: npm run test:demo-alert

import { buildDemoAlert, referrerLabel, shipModeLabel, escapeHtml } from "../lib/demo-alert";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

const base = {
  quoteNo: "Q-D-261105-92774",
  L: 24,
  W: 24,
  H: 16,
  qty: 5,
  shipMode: "box",
  materialName: "1.7# Black",
  printed: false,
  customerName: "Demo Prospect",
  customerEmail: "",
  company: "",
  notes: "",
  source: "landing-demo",
  referrer: "https://chatgpt.com/",
  adminBase: "https://api.alex-io.com",
  when: new Date("2026-11-05T16:10:13Z"),
};

// The Nov 5 Evansville visitor: anonymous, from ChatGPT
const a = buildDemoAlert(base);
check("subject has size, qty and source", a.subject === "Demo quote started: 24 × 24 × 16 in, qty 5 via chatgpt.com", a.subject);
check("anonymous visitor: no name in the subject", !a.subject.includes("Demo Prospect"));
check("link to the admin quote page", a.html.includes("https://api.alex-io.com/admin/quotes/Q-D-261105-92774"));
check("time shown in Eastern", a.html.includes("11:10") && a.html.includes("Nov 5, 2026"), a.html.match(/Nov[^<]*/)?.[0]);
check("type row for a box", a.html.includes("Foam + box (RSC)"));
check("printed row for a box", a.html.includes("Printed box"));
check("no Name / Email rows when blank", !a.html.includes(">Name<") && !a.html.includes(">Email<"));

// A visitor who typed contact details
const b = buildDemoAlert({ ...base, customerName: "Pat Lee", customerEmail: "pat@example.com", company: "Acme Foam", shipMode: "unsure", referrer: "", qty: 2500 });
check("name in the subject", b.subject.endsWith("(Pat Lee) via direct / unknown"), b.subject);
check("qty with thousands comma", b.subject.includes("qty 2,500"), b.subject);
check("contact rows shown", b.html.includes("pat@example.com") && b.html.includes("Acme Foam"));
check("insert only: no printed row", !b.html.includes("Printed box") && b.html.includes("Foam insert only"));

// Typed text is escaped (the endpoint is public)
const c = buildDemoAlert({ ...base, customerName: "<script>x</script>", notes: 'a "quote" & <b>' });
check("name escaped", !c.html.includes("<script>") && c.html.includes("&lt;script&gt;"));
check("notes escaped", c.html.includes("a &quot;quote&quot; &amp; &lt;b&gt;"));

// Helpers
check("referrer host without www", referrerLabel("https://www.google.com/search?q=foam") === "google.com");
check("bad referrer = direct", referrerLabel("not a url") === "direct / unknown");
check("utm_source word kept", referrerLabel("ChatGPT.com") === "chatgpt.com");

// The fixed sample button (landing-sample)
const s = buildDemoAlert({ ...base, source: "landing-sample", customerName: "Sample Customer", referrer: "https://www.google.com/" });
check("sample subject", s.subject === "Demo sample opened via google.com", s.subject);
check("sample placeholder name hidden", !s.html.includes("Sample Customer"));
check("mailer label", shipModeLabel("mailer") === "Foam + mailer");
check("escape apostrophe", escapeHtml("O'Neil") === "O&#39;Neil");
check("decimal sizes trimmed", buildDemoAlert({ ...base, L: 23.625, W: 23.6251, H: 3.71 }).subject.includes("23.625 × 23.625 × 3.71 in"));

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
