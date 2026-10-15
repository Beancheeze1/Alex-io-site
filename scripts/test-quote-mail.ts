// scripts/test-quote-mail.ts
//
// Step 29A: tests for the buyer status emails (app/lib/quote-mail-core.ts):
// shop link address, reply-to choice, subjects and content per email, and
// that shop text is escaped.
// Run: npm run test:mail   (= npx --yes tsx scripts/test-quote-mail.ts)

import { isEmail, isStatusKind, pickReplyTo, statusEmail, tenantBaseUrl, type StatusEmailData } from "../app/lib/quote-mail-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Shop link address
check("default shop keeps the core address", tenantBaseUrl("https://api.alex-io.com", "default"), "https://api.alex-io.com");
check("shop gets its own address", tenantBaseUrl("https://api.alex-io.com/", "mline"), "https://mline.api.alex-io.com");
check("no slug keeps the base", tenantBaseUrl("https://api.alex-io.com", null), "https://api.alex-io.com");
check("other hosts (local) keep the base", tenantBaseUrl("http://localhost:3000", "mline"), "http://localhost:3000");
check("odd slug ignored", tenantBaseUrl("https://api.alex-io.com", "bad slug!"), "https://api.alex-io.com");

// Reply-to
check("isEmail ok", isEmail("sales@mline.com"), true);
check("isEmail rejects two", isEmail("a@b.com, c@d.com"), false);
check("isEmail rejects blank", isEmail(""), false);
check("setting wins", pickReplyTo({ setting: "orders@shop.com", rep: "rep@shop.com", shop: "info@shop.com" }), "orders@shop.com");
check("rep when no setting", pickReplyTo({ setting: "", rep: "rep@shop.com", shop: "info@shop.com" }), "rep@shop.com");
check("shop page email last", pickReplyTo({ setting: "", rep: null, shop: "info@shop.com" }), "info@shop.com");
check("none -> null", pickReplyTo({}), null);

// Kinds
check("kind ok", isStatusKind("released"), true);
check("kind rejects quote", isStatusKind("quote"), false);

const d: StatusEmailData = {
  brand: "M-Line Packaging",
  quoteNo: "Q-A-261015-75644",
  link: "https://mline.api.alex-io.com/api/quote/open?to=%2Fquote&quote_no=Q-A-261015-75644&et=TOKEN",
  total: 2040,
  buyerName: "Pat Buyer",
  previousTotal: 1700,
  po: "PO-QA-28",
  leadTime: "3-4 weeks",
  validUntil: "2026-11-14T12:00:00Z",
  revision: "A",
};

const acc = statusEmail("accepted", d);
check("accepted subject", acc.subject, "M-Line Packaging: approval received for quote Q-A-261015-75644");
check("accepted names the total", acc.html.includes("$2,040.00"), true);
check("accepted shows the PO", acc.html.includes("PO-QA-28"), true);
check("accepted greets the buyer", acc.html.includes("Hi Pat Buyer,"), true);
check("re-approval subject", statusEmail("accepted", { ...d, reapproval: true }).subject, "M-Line Packaging: re-approval received for quote Q-A-261015-75644");

const conf = statusEmail("confirmed", d);
check("confirmed subject", conf.subject, "M-Line Packaging: order confirmed for quote Q-A-261015-75644");
check("confirmed lead time", conf.html.includes("3-4 weeks"), true);

const re = statusEmail("reapprove", d);
check("reapprove subject", re.subject, "M-Line Packaging: quote Q-A-261015-75644 was updated, please re-approve");
check("reapprove new total", re.html.includes("$2,040.00"), true);
check("reapprove old total", re.html.includes("$1,700.00"), true);
check("reapprove valid until", re.html.includes("Nov 14, 2026"), true);
check("reapprove button", re.html.includes("Review and re-approve"), true);

const rel = statusEmail("released", d);
check("released subject", rel.subject, "M-Line Packaging: quote Q-A-261015-75644 is in production");
check("released revision", rel.html.includes("(revision A)"), true);

check("link included (escaped &)", acc.html.includes("&amp;quote_no=Q-A-261015-75644&amp;et=TOKEN"), true);
check("no PO -> no PO row", statusEmail("confirmed", { ...d, po: null }).html.includes(">PO<"), false);
check("no name -> Hi there", statusEmail("confirmed", { ...d, buyerName: null }).html.includes("Hi there,"), true);

const evil = statusEmail("confirmed", { ...d, brand: "<b>Shop</b>", buyerName: "<script>x</script>" });
check("brand escaped in HTML", evil.html.includes("<b>Shop</b>"), false);
check("buyer name escaped", evil.html.includes("&lt;script&gt;"), true);
check("bad color falls back", statusEmail("confirmed", { ...d, primaryColor: "red;x:y" }).html.includes("red;x:y"), false);
check("brand color used", statusEmail("confirmed", { ...d, primaryColor: "#123456" }).html.includes("#123456"), true);
check("http logo ignored", statusEmail("confirmed", { ...d, logoUrl: "http://x.com/l.png" }).html.includes("<img"), false);
check("https logo used", statusEmail("confirmed", { ...d, logoUrl: "https://x.com/l.png" }).html.includes("<img"), true);

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
