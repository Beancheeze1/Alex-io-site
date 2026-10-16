// scripts/test-onboarding.ts
//
// Step 36A: tests for the onboarding rules (app/lib/onboarding-core.ts).
// Run: npm run test:onboarding   (= npx --yes tsx scripts/test-onboarding.ts)

import {
  accessEmail,
  canMark,
  checklist,
  cleanInvite,
  isStepKey,
  passwordProblem,
  starterGrades,
  starterPatch,
  STARTER_FOAM,
  STEPS,
  type Signals,
} from "../app/lib/onboarding-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const none: Signals = {
  shop_page: false,
  materials: false,
  foam_rates: false,
  corrugated: false,
  freight: false,
  emails_terms: false,
  staff: false,
  website: false,
  test_quote: false,
};

// ---- checklist
{
  const c = checklist(none, new Set(), "acme");
  check("checklist: 9 steps", c.total, 9);
  check("checklist: nothing done", c.done, 0);
  check("checklist: not complete", c.complete, false);
  check("checklist: slug in shop page href", c.items[0].href, "/t/acme");
  check("checklist: admin href unchanged", c.items.find((i) => i.key === "materials")?.href, "/admin/materials");
  check("checklist: how null when open", c.items[0].how, null);
}
{
  const c = checklist({ ...none, shop_page: true, foam_rates: true }, new Set(["staff", "website"]), "acme");
  check("checklist: auto + manual counted", c.done, 4);
  check("checklist: auto how", c.items.find((i) => i.key === "shop_page")?.how, "auto");
  check("checklist: manual how", c.items.find((i) => i.key === "staff")?.how, "manual");
}
{
  // a hand tick on a step without a manual option is ignored
  const c = checklist(none, new Set(["shop_page", "test_quote"]), "acme");
  check("checklist: non-manual tick ignored", c.done, 0);
}
{
  // auto beats manual
  const c = checklist({ ...none, staff: true }, new Set(["staff"]), "acme");
  check("checklist: auto wins over manual", c.items.find((i) => i.key === "staff")?.how, "auto");
  check("checklist: no double count", c.done, 1);
}
{
  const all = Object.fromEntries(Object.keys(none).map((k) => [k, true])) as Signals;
  const c = checklist(all, new Set(), "acme");
  check("checklist: all done complete", c.complete, true);
}
{
  const c = checklist(none, new Set(), "");
  check("checklist: empty slug -> default", c.items[0].href, "/t/default");
  const c2 = checklist(none, new Set(), "a b");
  check("checklist: slug encoded", c2.items[0].href, "/t/a%20b");
}

// ---- step keys
check("isStepKey: valid", isStepKey("freight"), true);
check("isStepKey: invalid", isStepKey("nope"), false);
check("isStepKey: non-string", isStepKey(3), false);
check("canMark: website yes", canMark("website"), true);
check("canMark: shop_page no", canMark("shop_page"), false);
check("canMark: test_quote no", canMark("test_quote"), false);
check("steps: unique keys", new Set(STEPS.map((s) => s.key)).size, STEPS.length);

// ---- starter rates
{
  const p = starterPatch({ cnc_setup_usd: 50, cnc_feed_in_per_min: 0, die_base_usd: "", press_rate_per_hr: null }, STARTER_FOAM);
  check("starterPatch: keeps set value", p.cnc_setup_usd, undefined);
  check("starterPatch: fills 0", p.cnc_feed_in_per_min, 300);
  check("starterPatch: fills empty string", p.die_base_usd, 150);
  check("starterPatch: fills null", p.press_rate_per_hr, 85);
  check("starterPatch: fills missing", p.lam_setup_usd, 25);
  check("starterPatch: count", Object.keys(p).length, Object.keys(STARTER_FOAM).length - 1);
  const full = starterPatch({ ...STARTER_FOAM }, STARTER_FOAM);
  check("starterPatch: nothing when all set", Object.keys(full).length, 0);
  check("starterPatch: NaN treated as empty", starterPatch({ cnc_setup_usd: "abc" }, { cnc_setup_usd: 35 }).cnc_setup_usd, 35);
}
{
  const g = starterGrades([
    { id: 1, name: "32 ECT C", cost_per_msf: null },
    { id: 2, name: "44 ECT C", cost_per_msf: 120 },
    { id: 3, name: "Custom kraft", cost_per_msf: null },
    { id: 4, name: "51 ECT BC", cost_per_msf: 0 },
  ]);
  check("starterGrades: count", g.length, 2);
  check("starterGrades: 32C", g[0]?.cost_per_msf, 90);
  check("starterGrades: 51BC zero filled", g.find((x) => x.id === 4)?.cost_per_msf, 190);
  check("starterGrades: priced grade kept", g.some((x) => x.id === 2), false);
}

// ---- passwords
check("password: short", passwordProblem("short") != null, true);
check("password: non-string", passwordProblem(undefined) != null, true);
check("password: repeated char", passwordProblem("aaaaaaaaaaaa") != null, true);
check("password: too long", passwordProblem("x".repeat(201)) != null, true);
check("password: ok", passwordProblem("correct horse"), null);
check("password: exactly 10 ok", passwordProblem("abcdefghij"), null);

// ---- invites
{
  const r = cleanInvite({ email: "  Pat@Example.COM ", name: "  Pat   Lee ", role: "Sales", sales_slug: "pat-lee" });
  check("invite: ok", r.ok, true);
  if (r.ok) {
    check("invite: email lowercased", r.value.email, "pat@example.com");
    check("invite: name squashed", r.value.name, "Pat Lee");
    check("invite: role lowercased", r.value.role, "sales");
    check("invite: slug", r.value.sales_slug, "pat-lee");
  }
}
{
  const bad = (v: unknown) => {
    const r = cleanInvite(v);
    return r.ok ? "ok" : r.field;
  };
  check("invite: bad email", bad({ email: "nope", name: "A", role: "cs" }), "email");
  check("invite: email with angle", bad({ email: "a<b>@x.com", name: "A", role: "cs" }), "email");
  check("invite: no name", bad({ email: "a@x.com", name: "  ", role: "cs" }), "name");
  check("invite: bad role", bad({ email: "a@x.com", name: "A", role: "owner" }), "role");
  check("invite: bad slug", bad({ email: "a@x.com", name: "A", role: "cs", sales_slug: "Bad Slug!" }), "sales_slug");
  check("invite: null input", bad(null), "email");
  const r = cleanInvite({ email: "a@x.com", name: "A", role: "viewer", sales_slug: "" });
  check("invite: empty slug -> null", r.ok ? r.value.sales_slug : "x", null);
}

// ---- access emails
{
  const m = accessEmail({
    kind: "invite",
    brand: "Acme <Foam>",
    name: "Pat",
    link: "https://acme.api.alex-io.com/set-password?t=abc&x=1",
    invitedBy: "Chuck",
    primaryColor: "#123456",
  });
  check("email invite: subject", m.subject, "Acme <Foam>: you're invited to Alex-IO");
  check("email invite: brand escaped", m.html.includes("Acme &lt;Foam&gt;"), true);
  check("email invite: no raw brand", m.html.includes("Acme <Foam>"), false);
  check("email invite: link escaped", m.html.includes("set-password?t=abc&amp;x=1"), true);
  check("email invite: invited by", m.html.includes("Chuck invited you"), true);
  check("email invite: color used", m.html.includes("#123456"), true);
  check("email invite: 7 days", m.html.includes("7 days"), true);
  check("email invite: button", m.html.includes("Set your password"), true);
}
{
  const m = accessEmail({
    kind: "reset",
    brand: "Acme",
    name: null,
    link: "https://x/set-password?t=1",
    primaryColor: "red;background:url(x)",
    logoUrl: "http://insecure/logo.png",
  });
  check("email reset: subject", m.subject, "Acme: reset your password");
  check("email reset: hi there", m.html.includes("Hi there,"), true);
  check("email reset: 60 minutes", m.html.includes("60 minutes"), true);
  check("email reset: bad color dropped", m.html.includes("red;background"), false);
  check("email reset: http logo dropped", m.html.includes("insecure/logo.png"), false);
  check("email reset: button", m.html.includes("Choose a new password"), true);
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
