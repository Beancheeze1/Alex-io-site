// scripts/test-proofs.ts
//
// Step 31: tests for artwork proofs (app/lib/proofs-core.ts) and the
// "proof ready" email (app/lib/quote-mail-core.ts).
// Run: npm run test:proofs   (= npx --yes tsx scripts/test-proofs.ts)

import {
  canRespondToProof,
  cleanProofText,
  factsPrinted,
  nextProofVersion,
  proofReleaseOk,
  proofResponseProblem,
  proofStage,
  type ProofRow,
} from "../app/lib/proofs-core";
import { statusEmail } from "../app/lib/quote-mail-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const none: ProofRow[] = [];
const v1sent: ProofRow[] = [{ version: 1, status: "sent" }];
const v1changes_v2sent: ProofRow[] = [
  { version: 1, status: "superseded" },
  { version: 2, status: "sent" },
];
const v2approved: ProofRow[] = [
  { version: 1, status: "superseded" },
  { version: 2, status: "approved" },
];
const v1changes: ProofRow[] = [{ version: 1, status: "changes" }];

check("no proofs -> none", proofStage(none).stage, "none");
check("sent -> waiting", proofStage(v1sent).stage, "waiting");
check("newest counts", proofStage(v1changes_v2sent).latest?.version, 2);
check("approved", proofStage(v2approved).stage, "approved");
check("changes", proofStage(v1changes).stage, "changes");
check("next version after none", nextProofVersion(none), 1);
check("next version after v2", nextProofVersion(v2approved), 3);

check("release ok when not required", proofReleaseOk(false, "none"), true);
check("release asks when required + none", proofReleaseOk(true, "none"), false);
check("release asks when waiting", proofReleaseOk(true, "waiting"), false);
check("release asks when changes", proofReleaseOk(true, "changes"), false);
check("release ok when approved", proofReleaseOk(true, "approved"), true);

check("answer newest waiting proof", canRespondToProof(v1changes_v2sent, 2, false), true);
check("can't answer an old version", canRespondToProof(v1changes_v2sent, 1, false), false);
check("can't answer twice", canRespondToProof(v2approved, 2, false), false);
check("can't answer on a released quote", canRespondToProof(v1sent, 1, true), false);
check("can't answer when none", canRespondToProof(none, 1, false), false);

check("approve needs name", proofResponseProblem({ action: "approve", name: "", comment: "", agree: "true" }), "Enter your name to approve the proof.");
check("approve needs tick", proofResponseProblem({ action: "approve", name: "Pat", comment: "", agree: "" }), "Tick the box to confirm you've checked the proof.");
check("approve ok", proofResponseProblem({ action: "approve", name: "Pat", comment: "", agree: "true" }), null);
check("changes need a comment", proofResponseProblem({ action: "changes", name: "", comment: "  ", agree: "" }), "Tell us what to change.");
check("changes ok", proofResponseProblem({ action: "changes", name: "", comment: "Logo bigger", agree: "" }), null);
check("bad action", proofResponseProblem({ action: "maybe", name: "", comment: "", agree: "" }), "Choose Approve or Request changes.");
check("text cleaned", cleanProofText("  Logo   bigger\r\nplease ", 100), "Logo bigger\nplease");

check("spot color prints", factsPrinted({ print_spec: { colors: ["spot"], sides: 1 } }), true);
check("no colors doesn't print", factsPrinted({ print_spec: { colors: [], sides: 1 }, printed: 1 }), false);
check("legacy printed flag", factsPrinted({ printed: 1 }), true);
check("per-box with plates prints", factsPrinted({ print_mode: "per_box" }, 195), true);
check("per-box without plates or flag", factsPrinted({ print_mode: "per_box" }, 0), false);
check("plain foam doesn't print", factsPrinted({}), false);

const base = { brand: "M-Line", quoteNo: "Q-A-1", link: "https://x/q", total: 1700 };
check("proof email subject v1", statusEmail("proof", { ...base, proofVersion: 1 }).subject, "M-Line: proof ready for quote Q-A-1");
check("proof email subject v2", statusEmail("proof", { ...base, proofVersion: 2 }).subject, "M-Line: proof ready for quote Q-A-1, version 2");
check("proof email note", statusEmail("proof", { ...base, proofVersion: 2, proofNote: "Moved the logo <up>" }).html.includes("Moved the logo &lt;up&gt;"), true);
check("proof email button", statusEmail("proof", { ...base, proofVersion: 1 }).html.includes("Review the proof"), true);

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
