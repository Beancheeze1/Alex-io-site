// app/admin/review/page.tsx
//
// Step 32: the staff review queue (GET/POST /api/admin/review-queue).
// Sections by reason, oldest first; each row links to the admin quote page,
// with Assign (staff member) and Snooze (tomorrow / 3 days / 1 week).
// Filters: Mine, Show snoozed.

"use client";

import * as React from "react";
import Link from "next/link";
import { QUEUE_SECTIONS, SECTION_TITLE, waitedLabel, type QueueItem, type QueueSection } from "@/app/lib/review-queue-core";

type Resp = {
  ok: boolean;
  sections: Record<QueueSection, QueueItem[]>;
  counts: Record<QueueSection, number> & { total: number };
  snoozed: number;
  staff: { id: number; name: string }[];
  me: number;
  message?: string;
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export default function ReviewQueuePage() {
  const [data, setData] = React.useState<Resp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [mine, setMine] = React.useState(false);
  const [snoozed, setSnoozed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (fresh = false) => {
      setErr(null);
      try {
        const qs = new URLSearchParams();
        if (mine) qs.set("mine", "1");
        if (snoozed) qs.set("snoozed", "1");
        if (fresh) qs.set("fresh", "1");
        const res = await fetch(`/api/admin/review-queue?${qs.toString()}`, { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as Resp | null;
        if (!res.ok || !j?.ok) {
          setErr(j?.message || `Couldn't load the queue (HTTP ${res.status}).`);
          return;
        }
        setData(j);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [mine, snoozed],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (quoteNo: string, body: Record<string, unknown>) => {
    setBusy(quoteNo);
    try {
      const res = await fetch("/api/admin/review-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_no: quoteNo, ...body }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) setErr(j?.message || `Couldn't save (HTTP ${res.status}).`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const sel = "rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)]";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6" data-review-queue>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          Review queue{data ? ` (${data.counts.total})` : ""}
        </h1>
        <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" data-filter-mine checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" data-filter-snoozed checked={snoozed} onChange={(e) => setSnoozed(e.target.checked)} /> Show snoozed
          {data && !snoozed && data.snoozed > 0 ? ` (${data.snoozed} hidden)` : ""}
        </label>
        <button type="button" className={sel} onClick={() => void load(true)}>
          Refresh
        </button>
      </div>
      {err ? <div className="mb-3 text-xs text-[var(--attention)]">{err}</div> : null}
      {!data ? (
        <div className="text-xs text-[var(--text-muted)]">Loading…</div>
      ) : (
        QUEUE_SECTIONS.map((sec) => {
          const rows = data.sections[sec] || [];
          return (
            <section key={sec} className="mb-5" data-queue-section={sec}>
              <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                {SECTION_TITLE[sec]} <span className="text-[var(--text-muted)]">({rows.length})</span>
              </h2>
              {rows.length === 0 ? (
                <div className="text-xs text-[var(--text-faint)]">Nothing here.</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${sec}-${r.quote_no}`} className="border-b border-[var(--border)] last:border-0" data-queue-row={r.quote_no}>
                          <td className="px-3 py-2 align-top whitespace-nowrap">
                            <Link href={`/admin/quotes/${encodeURIComponent(r.quote_no)}`} className="font-semibold text-[var(--text-primary)] hover:underline">
                              {r.quote_no}
                            </Link>
                            <div className="text-[var(--text-muted)]">{r.customer || "—"}</div>
                          </td>
                          <td className="px-3 py-2 align-top text-[var(--text-secondary)]">
                            {r.detail}
                            {r.snoozed_until && new Date(r.snoozed_until).getTime() > Date.now() ? (
                              <div className="text-[var(--text-faint)]">Snoozed until {day(r.snoozed_until)}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 align-top whitespace-nowrap text-[var(--text-muted)]">{waitedLabel(r.since, new Date())}</td>
                          <td className="px-3 py-2 align-top whitespace-nowrap">
                            <select
                              className={sel}
                              aria-label={`Assign ${r.quote_no}`}
                              data-assign={r.quote_no}
                              disabled={busy === r.quote_no}
                              value={r.assigned_user_id ?? ""}
                              onChange={(e) => void act(r.quote_no, { action: "assign", user_id: e.target.value === "" ? null : Number(e.target.value) })}
                            >
                              <option value="">Unassigned</option>
                              {data.staff.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.id === data.me ? `${u.name} (me)` : u.name}
                                </option>
                              ))}
                            </select>{" "}
                            <select
                              className={sel}
                              aria-label={`Snooze ${r.quote_no}`}
                              data-snooze={r.quote_no}
                              disabled={busy === r.quote_no}
                              value=""
                              onChange={(e) => e.target.value && void act(r.quote_no, { action: "snooze", until: e.target.value })}
                            >
                              <option value="">Snooze…</option>
                              <option value="tomorrow">Until tomorrow</option>
                              <option value="3d">3 days</option>
                              <option value="1w">1 week</option>
                              {r.snoozed_until ? <option value="clear">Un-snooze</option> : null}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
