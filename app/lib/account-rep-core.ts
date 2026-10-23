// app/lib/account-rep-core.ts
//
// Step 39O: who gets the commission on a new quote (pure, browser-safe).
// In order:
//   1. staff chose "No commission" on the form            -> nobody
//   2. a rep was named: the form's "Commission to", or the
//      buyer's /q/<slug> link (sales_rep_slug / sales_rep_id) -> that rep
//   3. the customer's account rep                          -> account rep
//   4. a Sales user making the quote                       -> themselves
//   5. otherwise                                           -> nobody
// "set by staff" (quotes.rep_set_by_staff) is true when staff made the
// choice on the form (1 or 2 from a signed-in staff user), so the quote is
// never auto-filled from the account later.

export type CommissionChoice = "auto" | "none" | "named";

/** The form's "Commission to": "" / "auto" = automatic, "none" = no commission, else a slug. */
export function commissionChoice(commissionTo: unknown, repId: unknown, repSlug: unknown): CommissionChoice {
  const c = typeof commissionTo === "string" ? commissionTo.trim().toLowerCase() : "";
  if (c === "none") return "none";
  const hasId = repId !== undefined && repId !== null && repId !== "" && Number.isFinite(Number(repId)) && Number(repId) > 0;
  const hasSlug = typeof repSlug === "string" && repSlug.trim() !== "";
  return hasId || hasSlug ? "named" : "auto";
}

export function resolveCommission(args: {
  choice: CommissionChoice;
  namedRepId: number | null; // the rep the slug / id points to (null = not found)
  accountRepId: number | null;
  creator: { id: number; role: string } | null; // signed-in staff making the quote
}): { repId: number | null; setByStaff: boolean } {
  const staff = !!args.creator;
  if (args.choice === "none") return { repId: null, setByStaff: staff };
  if (args.choice === "named" && args.namedRepId) return { repId: args.namedRepId, setByStaff: staff };
  if (args.accountRepId) return { repId: args.accountRepId, setByStaff: false };
  if (args.creator && args.creator.role.toLowerCase() === "sales") return { repId: args.creator.id, setByStaff: false };
  return { repId: null, setByStaff: false };
}

export type RepOption = { id: number; name: string; role: string; slug: string };

/** "Dana (CS)" */
export function repLabel(r: Pick<RepOption, "name" | "role"> | null | undefined): string {
  if (!r) return "No commission";
  const role = r.role.toLowerCase() === "cs" ? "CS" : r.role.charAt(0).toUpperCase() + r.role.slice(1).toLowerCase();
  return role ? `${r.name} (${role})` : r.name;
}
