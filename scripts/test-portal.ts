// scripts/test-portal.ts
//
// Step 34A: tests for the buyer portal rules (app/lib/portal-core.ts), the
// session cookie (lib/buyer-session.ts) and the "shipped" email.
// Run: npm run test:portal   (= npx --yes tsx scripts/test-portal.ts)

import {
  cleanShipped,
  isPortalEmail,
  normEmail,
  openActions,
  orderStage,
  orderTimeline,
  signInEmail,
  trackingUrl,
  type OrderFacts,
} from "../app/lib/portal-core";
import { hashLinkToken, newLinkToken, signSession, verifySession } from "../lib/buyer-session";
import { isStatusKind, statusEmail } from "../app/lib/quote-mail-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const now = new Date("2026-10-15T16:00:00Z");
const base: OrderFacts = {
  created_at: "2026-10-10T12:00:00Z",
  expires_at: "2026-11-09T12:00:00Z",
  accepted_at: null,
  accepted_name: null,
  confirmed_at: null,
  locked: false,
  locked_at: null,
  shipped_at: null,
  shipped_carrier: null,
  shipped_tracking: null,
  proof: null,
  ship_to_zip: null,
  terms: null,
};
const o = (p: Partial<OrderFacts>): OrderFacts => ({ ...base, ...p });

// emails
check("normEmail", normEmail("  Sam@Example.COM "), "sam@example.com");
check("email ok", isPortalEmail("sam@example.com"), true);
check("email bad", isPortalEmail("sam@example"), false);
check("email blank", isPortalEmail(""), false);
check("email not string", isPortalEmail(42), false);

// stages
check("stage estimate", orderStage(o({}), now), "estimate");
check("stage expired", orderStage(o({ expires_at: "2026-10-14T00:00:00Z" }), now), "expired");
check("stage never expires", orderStage(o({ expires_at: null }), now), "estimate");
check("stage accepted (even past expiry)", orderStage(o({ accepted_at: "2026-10-11T00:00:00Z", expires_at: "2026-10-12T00:00:00Z" }), now), "accepted");
check("stage confirmed", orderStage(o({ accepted_at: "2026-10-11T00:00:00Z", confirmed_at: "2026-10-12T00:00:00Z" }), now), "confirmed");
check("stage in production", orderStage(o({ confirmed_at: "2026-10-12T00:00:00Z", locked: true }), now), "in_production");
check("stage shipped", orderStage(o({ locked: true, shipped_at: "2026-10-14T00:00:00Z" }), now), "shipped");

// timeline
const tl = orderTimeline(o({ accepted_at: "2026-10-11T00:00:00Z", accepted_name: "Sam" }));
check("timeline steps without proof", tl.map((s) => s.key).join(","), "quoted,accepted,confirmed,production,shipped");
check("timeline accepted by", tl[1].detail, "by Sam");
check("timeline confirmed not done", tl[2].done, false);
const tlp = orderTimeline(o({ proof: { stage: "waiting", version: 2, required: true, at: null } }));
check("timeline with proof", tlp.map((s) => s.key).join(","), "quoted,accepted,confirmed,proof,production,shipped");
check("timeline proof waiting", tlp[3].detail, "v2 waiting for you");
const tla = orderTimeline(o({ proof: { stage: "approved", version: 3, required: true, at: "2026-10-13T00:00:00Z" } }));
check("timeline proof approved", `${tla[3].done}|${tla[3].detail}|${tla[3].at}`, "true|v3 approved|2026-10-13T00:00:00Z");
check("timeline no proof step when none needed", orderTimeline(o({ proof: { stage: "none", version: null, required: false, at: null } })).length, 5);
const tls = orderTimeline(o({ locked: true, locked_at: "2026-10-13T00:00:00Z", shipped_at: "2026-10-14T00:00:00Z", shipped_carrier: "UPS", shipped_tracking: "1Z999" }));
check("timeline shipped detail", tls[4].detail, "UPS 1Z999");
check("timeline production done", tls[3].done, true);

// actions
check("estimate -> accept", openActions(o({}), now, false).map((a) => a.key).join(","), "accept");
check("expired -> nothing", openActions(o({ expires_at: "2026-10-14T00:00:00Z" }), now, true).length, 0);
check("accepted -> nothing", openActions(o({ accepted_at: "2026-10-11T00:00:00Z", ship_to_zip: "60601" }), now, true).length, 0);
check("ship-to when freight set up", openActions(o({ accepted_at: "2026-10-11T00:00:00Z" }), now, true).map((a) => a.key).join(","), "ship_to");
check("no ship-to when pickup", openActions(o({ accepted_at: "2026-10-11T00:00:00Z", terms: "pickup" }), now, true).length, 0);
check("no ship-to without freight", openActions(o({ accepted_at: "2026-10-11T00:00:00Z" }), now, false).length, 0);
check("no ship-to once released", openActions(o({ locked: true }), now, true).length, 0);
check(
  "proof waiting",
  openActions(o({ accepted_at: "2026-10-11T00:00:00Z", ship_to_zip: "1", proof: { stage: "waiting", version: 2, required: true, at: null } }), now, true)
    .map((a) => a.label)
    .join(","),
  "Review proof v2",
);
check("proof changes is the shop's turn", openActions(o({ accepted_at: "x", ship_to_zip: "1", proof: { stage: "changes", version: 2, required: true, at: null } }), now, true).length, 0);

// tracking
check("ups url", trackingUrl("UPS", "1Z 999 AA1"), "https://www.ups.com/track?tracknum=1Z999AA1");
check("fedex url", trackingUrl("FedEx", "123456789012"), "https://www.fedex.com/fedextrack/?trknbr=123456789012");
check("usps url", trackingUrl("usps", "9400100000000000000000"), "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000");
check("ltl no url", trackingUrl("LTL / freight", "PRO123456"), null);
check("junk tracking no url", trackingUrl("UPS", "<script>"), null);
check("no tracking no url", trackingUrl("UPS", ""), null);

// shipped input
const s1 = cleanShipped({ carrier: " UPS ", tracking: "1Z999", note: "2 pallets" });
check("shipped ok", s1.ok && `${s1.value.carrier}|${s1.value.tracking}|${s1.value.note}`, "UPS|1Z999|2 pallets");
const s2 = cleanShipped({ carrier: "Our truck" });
check("shipped no tracking", s2.ok && s2.value.tracking, null);
const s3 = cleanShipped({ tracking: "1Z" });
check("shipped needs carrier", !s3.ok && s3.field, "carrier");
const s4 = cleanShipped({ carrier: "UPS", tracking: "<b>x</b>" });
check("shipped bad tracking", !s4.ok && s4.field, "tracking");
check("shipped junk body", cleanShipped(null).ok, false);
const s5 = cleanShipped({ carrier: "x".repeat(200), note: "y".repeat(900) });
check("shipped trims lengths", s5.ok && `${s5.value.carrier?.length}|${s5.value.note?.length}`, "60|300");

// sessions
const key = "test-secret-0123456789";
const v = signSession({ tenantId: 4, email: "Sam@Example.com", expires: now.getTime() + 1000 }, key);
const got = verifySession(v, key, now.getTime());
check("session round trip", got && `${got.tenantId}|${got.email}`, "4|sam@example.com");
check("session expired", verifySession(v, key, now.getTime() + 2000), null);
check("session wrong key", verifySession(v, "another-secret-000000", now.getTime()), null);
const [p, sig] = v.split(".");
const forged = Buffer.from(JSON.stringify({ t: 5, e: "sam@example.com", x: now.getTime() + 1000 })).toString("base64url");
check("session tampered tenant", verifySession(`${forged}.${sig}`, key, now.getTime()), null);
check("session tampered sig", verifySession(`${p}.${sig.slice(0, -1)}A`, key, now.getTime()), null);
check("session junk", verifySession("nope", key, now.getTime()), null);
check("session empty", verifySession("", key, now.getTime()), null);

// link tokens
const t1 = newLinkToken();
const t2 = newLinkToken();
check("token length", t1.length >= 40, true);
check("tokens differ", t1 !== t2, true);
check("token url-safe", /^[A-Za-z0-9_-]+$/.test(t1), true);
check("hash stable", hashLinkToken(t1) === hashLinkToken(t1), true);
check("hash hex 64", /^[0-9a-f]{64}$/.test(hashLinkToken(t1)), true);
check("hash differs", hashLinkToken(t1) !== hashLinkToken(t2), true);

// emails
const si = signInEmail({ brand: "M-Line <Foam>", link: "https://mline.api.alex-io.com/t/mline/orders/signin?t=abc", minutes: 30, primaryColor: "#123456" });
check("sign-in subject", si.subject, "M-Line <Foam>: your sign-in link");
check("sign-in escapes brand", si.html.includes("M-Line &lt;Foam&gt;") && !si.html.includes("<Foam>"), true);
check("sign-in link", si.html.includes('href="https://mline.api.alex-io.com/t/mline/orders/signin?t=abc"'), true);
check("sign-in minutes", si.html.includes("for 30 minutes"), true);
check("sign-in color", si.html.includes("#123456"), true);

check("shipped is a status kind", isStatusKind("shipped"), true);
const sh = statusEmail("shipped", {
  brand: "Shop",
  quoteNo: "Q-1",
  link: "https://x/quote?quote_no=Q-1",
  total: 100,
  buyerName: "Sam",
  po: "PO-9",
  shippedCarrier: "UPS",
  shippedTracking: "1Z999",
  trackingUrl: "https://www.ups.com/track?tracknum=1Z999",
});
check("shipped subject", sh.subject, "Shop: your order Q-1 has shipped");
check("shipped button tracks", sh.html.includes('href="https://www.ups.com/track?tracknum=1Z999"') && sh.html.includes("Track your shipment"), true);
check("shipped facts", sh.html.includes("1Z999") && sh.html.includes("PO-9") && sh.html.includes("by UPS"), true);
const sh2 = statusEmail("shipped", { brand: "Shop", quoteNo: "Q-1", link: "https://x/quote?quote_no=Q-1", total: 100, shippedCarrier: "Our truck" });
check("shipped no tracking -> quote link", sh2.html.includes('href="https://x/quote?quote_no=Q-1"') && sh2.html.includes("View your order"), true);
const rel = statusEmail("released", { brand: "Shop", quoteNo: "Q-1", link: "https://x/q", total: 1, trackingUrl: "https://evil" });
check("other kinds ignore trackingUrl", rel.html.includes('href="https://x/q"') && !rel.html.includes("evil"), true);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
if (failed) process.exit(1);
