// scripts/test-account-rep.ts
//
// Step 39O: who gets the commission on a new quote (app/lib/account-rep-core.ts).
// Run: npm run test:account-rep   (= npx --yes tsx scripts/test-account-rep.ts)

import { commissionChoice, repLabel, resolveCommission } from "../app/lib/account-rep-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${g}, want ${w}`);
  }
}

const cs = { id: 7, role: "cs" };
const sales = { id: 9, role: "sales" };
const admin = { id: 1, role: "admin" };

// The form's choice
check("choice: blank = auto", commissionChoice("", null, ""), "auto");
check("choice: none", commissionChoice("none", null, "chuck"), "none");
check("choice: a slug = named", commissionChoice(undefined, undefined, "dana"), "named");
check("choice: an id = named", commissionChoice(null, 3, null), "named");
check("choice: id 0 / junk = auto", commissionChoice(null, 0, "  "), "auto");

// Who gets it
check("CS on their own account (auto): CS, not marked", resolveCommission({ choice: "auto", namedRepId: null, accountRepId: 7, creator: cs }), { repId: 7, setByStaff: false });
check("CS quoting a salesperson's account (auto): the salesperson", resolveCommission({ choice: "auto", namedRepId: null, accountRepId: 9, creator: cs }), { repId: 9, setByStaff: false });
check("Sales on someone else's account: the account rep wins", resolveCommission({ choice: "auto", namedRepId: null, accountRepId: 7, creator: sales }), { repId: 7, setByStaff: false });
check("Sales, no account rep: themselves (as before)", resolveCommission({ choice: "auto", namedRepId: null, accountRepId: null, creator: sales }), { repId: 9, setByStaff: false });
check("admin, no account rep: nobody", resolveCommission({ choice: "auto", namedRepId: null, accountRepId: null, creator: admin }), { repId: null, setByStaff: false });
check("staff picked a rep: that rep, marked", resolveCommission({ choice: "named", namedRepId: 9, accountRepId: 7, creator: cs }), { repId: 9, setByStaff: true });
check("staff picked No commission: nobody, marked", resolveCommission({ choice: "none", namedRepId: null, accountRepId: 7, creator: admin }), { repId: null, setByStaff: true });
check("unknown slug: falls back to the account rep", resolveCommission({ choice: "named", namedRepId: null, accountRepId: 7, creator: cs }), { repId: 7, setByStaff: false });
check("email / AI quote (no staff): account rep", resolveCommission({ choice: "auto", namedRepId: null, accountRepId: 7, creator: null }), { repId: 7, setByStaff: false });
check("buyer link slug (no staff): that rep, not marked", resolveCommission({ choice: "named", namedRepId: 9, accountRepId: 7, creator: null }), { repId: 9, setByStaff: false });

// Labels
check("label: CS", repLabel({ name: "Dana", role: "cs" }), "Dana (CS)");
check("label: Sales", repLabel({ name: "Mike", role: "SALES" }), "Mike (Sales)");
check("label: none", repLabel(null), "No commission");
check("label: no role", repLabel({ name: "chuck", role: "" }), "chuck");

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
