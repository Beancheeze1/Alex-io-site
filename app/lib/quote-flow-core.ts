// app/lib/quote-flow-core.ts
//
// Step 39R: where a quote is in the flow, for the color dot on the admin
// quotes list (and its legend and filter chips). Pure; tested in
// scripts/test-quote-flow.ts. One stage per quote, the furthest it has
// reached (checked in this order):
//   shipped        marked shipped
//   in_production  released (RFM / locked)
//   reapprove      accepted (or confirmed) but the price changed since
//   confirmed      the shop confirmed the order
//   accepted       the buyer accepted; the shop needs to confirm
//   expired        an estimate past its valid-until date
//   sent           emailed / sent to the buyer, waiting on them
//   draft          not sent to the buyer yet
// Extra tags (shown next to the dot, not a stage): a proof waiting on the
// buyer or with changes requested, and a "needs review" flag.

export type FlowStage = "draft" | "sent" | "accepted" | "reapprove" | "expired" | "confirmed" | "in_production" | "shipped";

/** Left-to-right order for the legend / filter chips. */
export const FLOW_STAGES: readonly FlowStage[] = ["draft", "sent", "accepted", "reapprove", "expired", "confirmed", "in_production", "shipped"];

export const FLOW_INFO: Record<FlowStage, { label: string; hint: string; color: string }> = {
  draft: { label: "Draft", hint: "Not sent to the buyer yet", color: "#9ca3af" },
  sent: { label: "Sent", hint: "Waiting on the buyer", color: "#3b82f6" },
  accepted: { label: "Accepted", hint: "The buyer accepted: confirm the order", color: "#f59e0b" },
  reapprove: { label: "Re-approve", hint: "The price changed after the buyer accepted", color: "#ea580c" },
  expired: { label: "Expired", hint: "The estimate's valid-until date has passed", color: "#dc2626" },
  confirmed: { label: "Confirmed", hint: "Order confirmed: ready to release", color: "#8b5cf6" },
  in_production: { label: "In production", hint: "Released for manufacturing (RFM)", color: "#16a34a" },
  shipped: { label: "Shipped", hint: "Marked shipped", color: "#0d9488" },
};

export type FlowFacts = {
  locked: boolean;
  shipped_at: string | null;
  accepted_at: string | null;
  confirmed_at: string | null;
  reapprove: boolean; // the review queue's "price changed" section
  expired: boolean; // effective expiry passed (computeApproval)
  sent: boolean; // status sent / revised, or a quote email went out
};

export function flowStage(f: FlowFacts): FlowStage {
  if (f.shipped_at) return "shipped";
  if (f.locked) return "in_production";
  if (f.reapprove) return "reapprove";
  if (f.confirmed_at) return "confirmed";
  if (f.accepted_at) return "accepted";
  if (f.expired) return "expired";
  if (f.sent) return "sent";
  return "draft";
}

export function isFlowStage(v: unknown): v is FlowStage {
  return typeof v === "string" && (FLOW_STAGES as readonly string[]).includes(v);
}

/** How many quotes in each stage (every stage present, 0 when none). */
export function flowCounts(stages: (FlowStage | null | undefined)[]): Record<FlowStage, number> {
  const out = Object.fromEntries(FLOW_STAGES.map((s) => [s, 0])) as Record<FlowStage, number>;
  for (const s of stages) if (s && isFlowStage(s)) out[s]++;
  return out;
}

/**
 * Step 39R: the quotes list's row button. Released: "Unlock & revise".
 * Not released: "Revise" for foam (opens the editor), "Edit" for box-only
 * (opens the quote page).
 */
export function reviseLabel(row: { locked?: boolean | null; boxes_only?: boolean | null }): string {
  if (row.locked) return "Unlock & revise";
  return row.boxes_only ? "Edit" : "Revise";
}
