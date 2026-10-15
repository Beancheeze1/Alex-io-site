// app/lib/review-queue-core.ts
//
// Step 32: the staff review queue's rules (pure; tested in
// scripts/test-review-queue.ts). Sections, oldest first:
//   new           buyer / email quotes no staff member has opened yet
//   to_confirm    the buyer accepted; staff haven't confirmed
//   reapprove     accepted, but the price changed since
//   proofs        the buyer asked for changes, or a proof has waited 3+ days
//   needs_review  review flags (fit / walls / cavities) or a box priced
//                 without a price, on an unreleased quote
// Each quote can be assigned to a staff member and snoozed until a date.

export type QueueSection = "new" | "to_confirm" | "reapprove" | "proofs" | "needs_review";
export const QUEUE_SECTIONS: readonly QueueSection[] = ["new", "to_confirm", "reapprove", "proofs", "needs_review"];
export const SECTION_TITLE: Record<QueueSection, string> = {
  new: "New, not opened",
  to_confirm: "Accepted, waiting for you to confirm",
  reapprove: "Price changed since the buyer accepted",
  proofs: "Proofs: changes requested or waiting",
  needs_review: "Needs review",
};

export const PROOF_WAIT_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type QueueItem = {
  section: QueueSection;
  quote_id: number;
  quote_no: string;
  customer: string | null;
  since: string; // ISO: when it started waiting
  detail: string;
  assigned_user_id: number | null;
  assigned_name: string | null;
  snoozed_until: string | null;
};

export function isSnoozed(item: Pick<QueueItem, "snoozed_until">, now: Date): boolean {
  if (!item.snoozed_until) return false;
  const t = new Date(item.snoozed_until).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/** Items to show, oldest first: snoozed ones only when asked, "mine" = assigned to that user. */
export function visibleItems(
  items: QueueItem[],
  opts: { now: Date; showSnoozed?: boolean; mineUserId?: number | null },
): QueueItem[] {
  return items
    .filter((i) => opts.showSnoozed || !isSnoozed(i, opts.now))
    .filter((i) => opts.mineUserId == null || i.assigned_user_id === opts.mineUserId)
    .sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime() || a.quote_no.localeCompare(b.quote_no));
}

export function groupBySection(items: QueueItem[]): Record<QueueSection, QueueItem[]> {
  const out = Object.fromEntries(QUEUE_SECTIONS.map((s) => [s, [] as QueueItem[]])) as Record<QueueSection, QueueItem[]>;
  for (const i of items) out[i.section].push(i);
  return out;
}

export function sectionCounts(items: QueueItem[]): Record<QueueSection, number> & { total: number } {
  const g = groupBySection(items);
  const counts = Object.fromEntries(QUEUE_SECTIONS.map((s) => [s, g[s].length])) as Record<QueueSection, number>;
  return { ...counts, total: items.length };
}

/** A proof belongs in the queue when changes were requested, or it has waited PROOF_WAIT_DAYS+. */
export function proofNeedsAttention(p: { status: string; sent_at: string | null }, now: Date): boolean {
  if (p.status === "changes") return true;
  if (p.status !== "sent" || !p.sent_at) return false;
  const t = new Date(p.sent_at).getTime();
  return Number.isFinite(t) && now.getTime() - t >= PROOF_WAIT_DAYS * DAY_MS;
}

export function waitedLabel(since: string, now: Date): string {
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h`;
  return `${Math.round(hrs / 24)} days`;
}

/** Snooze choices -> the date to snooze until (start of that day, UTC noon to dodge time zones). */
export function snoozeUntil(choice: unknown, now: Date): string | null | undefined {
  if (choice === null || choice === "" || choice === "clear") return null;
  const days = choice === "tomorrow" ? 1 : choice === "3d" ? 3 : choice === "1w" ? 7 : null;
  if (days != null) return new Date(now.getTime() + days * DAY_MS).toISOString();
  if (typeof choice === "string" && /^\d{4}-\d{2}-\d{2}$/.test(choice)) {
    const t = new Date(`${choice}T12:00:00Z`);
    return Number.isFinite(t.getTime()) && t.getTime() > now.getTime() ? t.toISOString() : undefined;
  }
  return undefined; // not valid
}
