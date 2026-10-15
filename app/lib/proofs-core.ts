// app/lib/proofs-core.ts
//
// Step 31: artwork proof rules (pure; tested in scripts/test-proofs.ts).
//   - a quote's proofs are versions v1, v2, ...; only the newest counts
//   - a new version supersedes every earlier one (an approval of v1 doesn't
//     carry over to v2)
//   - the buyer answers the newest proof while it's "sent": approve (name +
//     "I've checked" tick) or request changes (comment, optional file)
//   - proofs are required on printed quotes; release for manufacturing asks
//     staff to confirm when the newest proof isn't approved

export type ProofStatus = "sent" | "approved" | "changes" | "superseded";
export type ProofStage = "none" | "waiting" | "approved" | "changes";

export type ProofRow = {
  version: number;
  status: ProofStatus;
};

export const MAX_PROOF_COMMENT = 2000;
export const MAX_PROOF_NOTE = 1000;

export function proofStage<T extends ProofRow>(rows: T[]): { stage: ProofStage; latest: T | null } {
  const latest = rows.reduce<T | null>((best, r) => (!best || r.version > best.version ? r : best), null);
  if (!latest) return { stage: "none", latest: null };
  if (latest.status === "approved") return { stage: "approved", latest };
  if (latest.status === "changes") return { stage: "changes", latest };
  return { stage: "waiting", latest };
}

/** Release is fine without asking when no proof is required, or the newest proof is approved. */
export function proofReleaseOk(required: boolean, stage: ProofStage): boolean {
  return !required || stage === "approved";
}

/** The newest proof can be answered while it's waiting, on an unreleased quote. */
export function canRespondToProof<T extends ProofRow>(rows: T[], version: number, locked: boolean): boolean {
  const { stage, latest } = proofStage(rows);
  return !locked && stage === "waiting" && !!latest && latest.version === version;
}

export function nextProofVersion(rows: ProofRow[]): number {
  return rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;
}

export function cleanProofText(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
  return s || null;
}

/** Problems with a buyer's answer, or null. */
export function proofResponseProblem(a: {
  action: unknown;
  name: unknown;
  comment: unknown;
  agree: unknown;
}): string | null {
  if (a.action !== "approve" && a.action !== "changes") return "Choose Approve or Request changes.";
  if (a.action === "approve") {
    if (!cleanProofText(a.name, 120)) return "Enter your name to approve the proof.";
    if (a.agree !== true && a.agree !== "true" && a.agree !== "1") {
      return "Tick the box to confirm you've checked the proof.";
    }
    return null;
  }
  if (!cleanProofText(a.comment, MAX_PROOF_COMMENT)) return "Tell us what to change.";
  return null;
}

/** Printed per the quote's facts (same rules as app/lib/pricing/print-charges.ts). */
export function factsPrinted(facts: Record<string, unknown> | null | undefined, platesTotal = 0): boolean {
  const f = facts || {};
  const flag = f.printed === 1 || f.printed === "1" || f.printed === true;
  if (f.print_mode === "per_box") return platesTotal > 0 || flag;
  const spec = f.print_spec as { colors?: unknown } | null | undefined;
  if (spec && typeof spec === "object" && Array.isArray(spec.colors)) return spec.colors.length > 0;
  return flag;
}
