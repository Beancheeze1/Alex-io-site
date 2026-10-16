// scripts/test-quote-mail.ts
//
// Step 29A: tests for the buyer status emails (app/lib/quote-mail-core.ts):
// shop link address, reply-to choice, subjects and content per email, and
// that shop text is escaped.
// Step 29B: the reminder rules and emails (app/lib/reminders-core.ts).
// Run: npm run test:mail   (= npx --yes tsx scripts/test-quote-mail.ts)

import { isEmail, isStatusKind, pickReplyTo, statusEmail, tenantBaseUrl, type StatusEmailData } from "../app/lib/quote-mail-core";
import {
  approxExpiry,
  digestHasNews,
  expiringDue,
  expiringKey,
  followupDue,
  isTimeZone,
  shopClock,
  staffDigestEmail,
} from "../app/lib/reminders-core";
import { renderQuoteEmail } from "../app/lib/email/quoteTemplate";

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

// ---- Step 29B: reminders ----
const now = new Date("2026-10-15T16:30:00Z"); // 12:30 PM New York
check("time zone ok", isTimeZone("America/Chicago"), true);
check("time zone rejects junk", isTimeZone("Mars/Base"), false);
check("shop hour in New York", shopClock(now, "America/New_York").hour, 12);
check("shop day in New York", shopClock(now, "America/New_York").day, "2026-10-15");
check("shop day rolls over in Tokyo", shopClock(now, "Asia/Tokyo").day, "2026-10-16");
check("bad zone falls back to New York", shopClock(now, "nope").hour, 12);

const row = { created_at: "2026-10-01T12:00:00Z", priced_at: null, expires_at: null };
check("expiry = created + 30 days", approxExpiry(row, 30), "2026-10-31T12:00:00.000Z");
check("reprice restarts expiry", approxExpiry({ ...row, priced_at: "2026-10-10T12:00:00Z" }, 30), "2026-11-09T12:00:00.000Z");
check("staff date wins", approxExpiry({ ...row, expires_at: "2026-10-20T23:59:59Z" }, 30), "2026-10-20T23:59:59.000Z");
check("0 days = never", approxExpiry(row, 0), null);

check("expires in 4 days: due (5-day window)", expiringDue("2026-10-19T16:30:00Z", now, 5), true);
check("expires in 6 days: not yet", expiringDue("2026-10-21T16:30:00Z", now, 5), false);
check("already expired: no reminder", expiringDue("2026-10-15T16:00:00Z", now, 5), false);
check("no expiry: no reminder", expiringDue(null, now, 5), false);
check("expiring key is the day", expiringKey("2026-10-19T16:30:00Z"), "expires 2026-10-19");

check("follow-up after 3 days", followupDue("2026-10-12T16:30:00Z", now, 3), true);
check("no follow-up after 2 days", followupDue("2026-10-13T16:30:00Z", now, 3), false);
check("no follow-up without a quote email", followupDue(null, now, 3), false);

const exp = statusEmail("expiring", { ...d, validUntil: "2026-10-19T16:30:00Z" });
check("expiring subject", exp.subject, "M-Line Packaging: quote Q-A-261015-75644 expires Oct 19, 2026");
check("expiring button", exp.html.includes("Review and accept"), true);
const fol = statusEmail("followup", { ...d, sentAt: "2026-10-12T16:30:00Z" });
check("follow-up subject", fol.subject, "M-Line Packaging: following up on quote Q-A-261015-75644");
check("follow-up names the send date", fol.html.includes("on Oct 12, 2026"), true);
check("reminder kinds known", isStatusKind("expiring") && isStatusKind("followup"), true);

const dig = {
  brand: "M-Line <Packaging>",
  day: "2026-10-15",
  baseUrl: "https://mline.api.alex-io.com",
  toConfirm: [{ quote_no: "Q-A-1", customer: "Acme", total: 1700, note: "accepted by Pat, PO 7" }],
  newQuotes: [{ quote_no: "Q-A-2", customer: null, note: "draft" }],
  newCount: 3,
  expiring: [],
};
const de = staffDigestEmail(dig);
check("digest subject", de.subject, "M-Line <Packaging> quotes for Oct 15, 2026: 1 to confirm, 3 new, 0 expiring");
check("digest links the admin page", de.html.includes("https://mline.api.alex-io.com/admin/quotes/Q-A-1"), true);
check("digest shows accepted total", de.html.includes("$1,700.00"), true);
check("digest '...and N more'", de.html.includes("and 2 more"), true);
check("digest escapes brand", de.html.includes("M-Line <Packaging>"), false);
check("digest has news", digestHasNews(dig), true);
check("empty digest is skipped", digestHasNews({ toConfirm: [], newCount: 0, expiring: [] }), false);

// Step 36E: the quote email (same style as the status emails)
{
  const base = {
    quoteNumber: "Q-A-1",
    status: "applied",
    plainLinks: true,
    specs: { L_in: 10, W_in: 8, H_in: 2, qty: 1, density_pcf: 1.7, foam_family: "Polyethylene" },
    material: { name: "EPE", density_lbft3: 1.7 },
    pricing: { total: 1369.63 },
    missing: [],
    grandTotal: 1369.63,
    quotePageUrl: "https://api.alex-io.com/quote?quote_no=Q-A-1",
  };
  const h = renderQuoteEmail({ ...base, brand: "Acme <Foam>", buyerName: "Pat", primaryColor: "#123456", shippingEstimate: 136.96, roughShipPct: 10, shippingCapUsd: 200 });
  check("quote email: total is the quote total", h.includes('data-quote-total>$1,369.63<'), true);
  check("quote email: shipping not added in", h.includes("1,506.59"), false);
  check("quote email: rough shipping as its own line", h.includes("Estimated shipping, not included: about $136.96 (10% of the order)"), true);
  check("quote email: brand escaped", h.includes("Acme &lt;Foam&gt;") && !h.includes("Acme <Foam>"), true);
  check("quote email: shop color", h.includes("#123456"), true);
  check("quote email: no old Powered by header", h.includes("Powered by"), false);
  check("quote email: no internal status", /applied/i.test(h.replace(/data-[a-z-]+/g, "")), false);
  check("quote email: no sales@alex-io.com", h.includes("sales@alex-io.com"), false);
  check("quote email: greets buyer", h.includes("Hi Pat,"), true);
  check("quote email: reply footer", h.includes("Reply to this email with any questions."), true);
  const h2 = renderQuoteEmail({ ...base, buyerName: "Customer", revisionLabel: "B", primaryColor: "red;x" });
  check("quote email: generic name -> there", h2.includes("Hi there,"), true);
  check("quote email: released revision shown", h2.includes("(revision B)"), true);
  check("quote email: bad color dropped", h2.includes("red;x"), false);
  check("quote email: default brand", h2.includes(">Alex-IO<"), true);
  check("quote email: no shipping line without estimate", h2.includes("data-rough-shipping"), false);
  const h3 = renderQuoteEmail({ ...base, lineItems: [{ id: 1, label: "Box <b>", dims: "1 × 1 × 1 in", qty: 2, unitPrice: 1, lineTotal: 2 }], printLabel: "Packaging &ndash; Plates", printingUpcharge: 50 });
  check("quote email: line label escaped", h3.includes("Box &lt;b&gt;"), true);
  check("quote email: existing entity kept", h3.includes("Packaging &ndash; Plates"), true);
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
