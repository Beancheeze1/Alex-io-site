// scripts/test-funnel.ts
//
// Step 35: tests for the quote funnel rules (app/lib/funnel-core.ts).
// Run: npm run test:funnel   (= npx --yes tsx scripts/test-funnel.ts)

import {
  byChannel,
  byRep,
  byShop,
  channelOf,
  cleanDays,
  cycleTimes,
  durationLabel,
  funnel,
  funnelCsv,
  median,
  reached,
  quoteAdminUrl,
  stalled,
  type FunnelQuote,
} from "../app/lib/funnel-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const now = new Date("2026-10-20T12:00:00Z");
const base: FunnelQuote = {
  quote_no: "Q-A-261001-00001",
  tenant_id: 1,
  tenant_name: "Shop One",
  customer: "Acme",
  created_at: "2026-10-01T12:00:00Z",
  priced: false,
  emailed: false,
  ai_email: false,
  quote_source: "direct",
  rep_id: null,
  rep_name: null,
  reorder_of: null,
  accepted_at: null,
  accepted_total: null,
  confirmed_at: null,
  confirmed_total: null,
  released: false,
  released_at: null,
  shipped_at: null,
  expires_at: null,
};
let n = 0;
const qq = (p: Partial<FunnelQuote>): FunnelQuote => ({ ...base, quote_no: `Q-A-261001-${String(++n).padStart(5, "0")}`, ...p });

// channels
check("channel online", channelOf(qq({})), "online");
check("channel embed", channelOf(qq({ quote_source: "embed_website" })), "embed");
check("channel AI email", channelOf(qq({ ai_email: true })), "email_ai");
check("channel staff R", channelOf(qq({ quote_no: "Q-R-261001-12345", rep_id: 3 })), "staff");
check("channel staff legacy REP", channelOf(qq({ quote_no: "Q-REP-20260101-101010" })), "staff");
check("channel rep link", channelOf(qq({ rep_id: 3 })), "rep_link");
check("channel reorder wins", channelOf(qq({ reorder_of: "Q-A-1", quote_source: "embed_website", ai_email: true })), "reorder");
check("channel embed beats AI", channelOf(qq({ quote_source: "embed_website", ai_email: true })), "embed");

// reached
const r1 = reached(qq({ shipped_at: "2026-10-10T00:00:00Z" }));
check("shipped implies all", Object.values(r1).every(Boolean), true);
check("emailed counts as priced", reached(qq({ emailed: true })).priced, true);
check("accepted implies priced", reached(qq({ accepted_at: "2026-10-02T00:00:00Z" })).priced, true);
check("bare quote: created only", Object.entries(reached(qq({}))).filter(([, v]) => v).map(([k]) => k).join(","), "created");
check("released implies confirmed", reached(qq({ released: true })).confirmed, true);

// funnel
const qs: FunnelQuote[] = [
  qq({}),
  qq({ priced: true }),
  qq({ priced: true, accepted_at: "2026-10-02T12:00:00Z", accepted_total: 1000 }),
  qq({ priced: true, accepted_at: "2026-10-02T12:00:00Z", accepted_total: 2000, confirmed_at: "2026-10-03T12:00:00Z", confirmed_total: 2100 }),
  qq({
    priced: true,
    accepted_at: "2026-10-01T18:00:00Z",
    accepted_total: 500,
    confirmed_at: "2026-10-02T12:00:00Z",
    confirmed_total: 500,
    released: true,
    released_at: "2026-10-04T12:00:00Z",
    shipped_at: "2026-10-08T12:00:00Z",
    rep_id: 7,
    rep_name: "Pat",
  }),
];
const f = funnel(qs);
check("funnel counts", f.map((s) => s.count).join(","), "5,4,3,2,1,1");
check("funnel % of created", f.map((s) => s.pct_of_created).join(","), ",80,60,40,20,20");
check("funnel % of previous", f[2].pct_of_previous, 75);
check("funnel accepted $", f[2].value, 3500);
check("funnel confirmed $ (confirmed total)", f[3].value, 2600);
check("funnel shipped $", f[5].value, 500);
check("funnel no $ before accepted", f[0].value === null && f[1].value === null, true);
check("funnel empty", funnel([]).map((s) => `${s.count}/${s.pct_of_previous}`).join(","), "0/null,0/null,0/null,0/null,0/null,0/null");

// groups
const ch = byChannel([...qs, qq({ quote_source: "embed_website", accepted_at: "2026-10-05T00:00:00Z", confirmed_at: "2026-10-06T00:00:00Z", confirmed_total: 300 })]);
check("by channel order (most quotes first, then name)", ch.map((g) => `${g.key}:${g.created}`).join(","), "online:4,rep_link:1,embed:1");
check("by channel win rate", ch[0].win_rate, 25);
check("by channel confirmed $", ch.find((g) => g.key === "embed")?.confirmed_value, 300);
const rep = byRep(qs);
check("by rep", rep.map((g) => `${g.label}:${g.created}:${g.confirmed}`).join(","), "No rep:4:1,Pat:1:1");
check("by shop", byShop([qq({}), qq({ tenant_id: 2, tenant_name: "Shop Two" }), qq({ tenant_id: 2, tenant_name: "Shop Two" })]).map((g) => `${g.label}:${g.created}`).join(","), "Shop Two:2,Shop One:1");

// cycle times
check("median odd", median([5, 1, 3]), 3);
check("median even", median([1, 2, 3, 10]), 2.5);
check("median empty", median([]), null);
const c = cycleTimes(qs);
check("cycle quote->accept (6h, 24h, 24h)", c[0].median_hours, 24);
check("cycle accept->confirm", `${c[1].median_hours}/${c[1].count}`, "21/2");
check("cycle confirm->release", c[2].median_hours, 48);
check("cycle release->ship", c[3].median_hours, 96);
check("cycle overall", c[4].median_hours, 168);
check("cycle ignores negative", cycleTimes([qq({ accepted_at: "2026-09-01T00:00:00Z" })])[0].count, 0);
check("duration min", durationLabel(0.5), "30 min");
check("duration hours", durationLabel(6.54), "6.5 h");
check("duration days", durationLabel(72), "3 days");
check("duration none", durationLabel(null), "—");

// stalled
const st = stalled(
  [
    qq({ priced: true, created_at: "2026-10-01T12:00:00Z" }), // estimate 19 days
    qq({ priced: true, created_at: "2026-10-18T12:00:00Z" }), // estimate 2 days: fine
    qq({ priced: true, created_at: "2026-09-01T12:00:00Z", expires_at: "2026-10-01T12:00:00Z" }), // expired: left out
    qq({ priced: true, accepted_at: "2026-10-15T12:00:00Z", accepted_total: 900 }), // accepted 5 days
    qq({ priced: true, accepted_at: "2026-10-19T12:00:00Z" }), // accepted 1 day: fine
    qq({ accepted_at: "2026-10-01T12:00:00Z", confirmed_at: "2026-10-10T12:00:00Z", confirmed_total: 700 }), // confirmed 10 days
    qq({ released: true, released_at: "2026-10-01T12:00:00Z" }), // released 19 days
    qq({ released: true, released_at: "2026-10-01T12:00:00Z", shipped_at: "2026-10-05T12:00:00Z" }), // shipped: fine
    qq({}), // never priced: not an estimate
  ],
  now,
);
check("stalled count", st.length, 4);
check("stalled longest first", st.map((s) => s.days).join(","), "19,19,10,5");
check("stalled stages", st.map((s) => s.stage).sort().join("|"), "Accepted, not confirmed|Confirmed, not released|Estimate, not accepted|Released, not shipped");
check("stalled value", st.find((s) => s.stage === "Accepted, not confirmed")?.value, 900);

// csv
const csv = funnelCsv([qq({ customer: '=HYPERLINK("x")', rep_id: 7, rep_name: "Pat, Jr", accepted_at: "2026-10-02T00:00:00Z", accepted_total: 10 })]);
const lines = csv.trim().split("\r\n");
check("csv header", lines[0].startsWith("quote_no,shop,customer,created_at,channel,rep"), true);
check("csv rows", lines.length, 2);
check("csv formula guarded", lines[1].includes(`"'=HYPERLINK(""x"")"`), true);
check("csv comma quoted", lines[1].includes('"Pat, Jr"'), true);
check("csv stage", lines[1].includes("Accepted by the buyer"), true);

// days
check("days 30", cleanDays("30"), 30);
check("days 365", cleanDays(365), 365);
check("days junk -> 90", cleanDays("7"), 90);

// Step 36C: quotes released without an accepted price, and links to other shops' quotes
{
  const f = funnel([
    qq({ priced: true, released: true, released_at: "2026-10-05T00:00:00Z" }),
    qq({ priced: true, accepted_at: "2026-10-02T00:00:00Z", accepted_total: 500, confirmed_at: "2026-10-03T00:00:00Z", confirmed_total: 500, released: true, released_at: "2026-10-04T00:00:00Z" }),
  ]);
  const prod = f.find((s) => s.key === "production");
  check("production count", prod?.count, 2);
  check("production $ from priced quotes only", prod?.value, 500);
  check("production no_total", prod?.no_total, 1);
  check("created no_total 0", f[0].no_total, 0);
  check("priced no_total 0", f[1].no_total, 0);
}
check("admin url own shop", quoteAdminUrl("Q-A-1", 1, 1, "https://mline.api.alex-io.com"), "/admin/quotes/Q-A-1");
check("admin url other shop", quoteAdminUrl("Q-A-1", 7, 1, "https://mline.api.alex-io.com/"), "https://mline.api.alex-io.com/admin/quotes/Q-A-1");
check("admin url no base", quoteAdminUrl("Q-A-1", 7, 1, null), "/admin/quotes/Q-A-1");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
if (failed) process.exit(1);
